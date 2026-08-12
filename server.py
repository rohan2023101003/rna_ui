#!/usr/bin/env python3
"""Local web server for the Road Numbering evaluation interface.

Standard library only - no pip install required. Run it and open the printed
URL:

    python3 server.py                 # http://127.0.0.1:8000
    python3 server.py --port 9000
    python3 server.py --data ./data --results ./results

API
---
GET  /api/datasets                                list bundled + uploaded datasets
GET  /api/datasets/<city>/<network>               road + node geometry as GeoJSON
GET  /api/datasets/<city>/<network>/numbering/<a> one algorithm's road numbers
POST /api/upload                                  add a dataset from the browser
POST /api/events                                  append interaction/feedback events
GET  /api/events                                  read back the event log
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import posixpath
import re
import shutil
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from rna import dataset as ds
from rna.dataset import DatasetError

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")

MAX_UPLOAD_BYTES = 128 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class Store:
    """Dataset discovery, geometry caching and event logging."""

    def __init__(self, data_root: str, results_root: str, upload_root: str,
                 log_path: str):
        self.data_root = data_root
        self.results_root = results_root
        self.upload_root = upload_root
        self.log_path = log_path
        self._geometry_cache: dict[str, dict] = {}
        self._lock = threading.Lock()
        os.makedirs(self.upload_root, exist_ok=True)

    # -- discovery ---------------------------------------------------------

    def catalogue(self) -> list[dict]:
        entries = [dict(d, source="bundled")
                   for d in ds.discover(self.data_root, self.results_root)]
        entries += [dict(d, source="uploaded") for d in self._uploaded()]
        return entries

    def _uploaded(self) -> list[dict]:
        found = []
        if not os.path.isdir(self.upload_root):
            return found
        for entry in sorted(os.listdir(self.upload_root)):
            base = os.path.join(self.upload_root, entry)
            manifest_path = os.path.join(base, "manifest.json")
            if not os.path.isfile(manifest_path):
                continue
            try:
                with open(manifest_path, encoding="utf-8") as fh:
                    manifest = json.load(fh)
            except (OSError, ValueError):
                continue
            net_dir = os.path.join(base, "network")
            res_dir = os.path.join(base, "results")
            if not os.path.isdir(net_dir):
                continue
            record = ds.describe(net_dir, res_dir if os.path.isdir(res_dir) else None,
                                 city=manifest.get("city", "Uploaded"),
                                 network=manifest.get("network", entry))
            record["id"] = f"uploads/{entry}"
            record["uploaded_at"] = manifest.get("uploaded_at")
            found.append(record)
        return found

    def resolve(self, dataset_id: str) -> dict:
        for entry in self.catalogue():
            if entry["id"] == dataset_id:
                return entry
        raise DatasetError(f"unknown dataset '{dataset_id}'")

    # -- geometry ----------------------------------------------------------

    def geometry(self, dataset_id: str) -> dict:
        with self._lock:
            cached = self._geometry_cache.get(dataset_id)
        if cached is not None:
            return cached

        entry = self.resolve(dataset_id)
        network = ds.load_network(entry["path"])
        payload = {
            "dataset": {k: v for k, v in entry.items()
                        if k not in ("path", "results_path")},
            **network,
        }
        with self._lock:
            self._geometry_cache[dataset_id] = payload
        return payload

    def numbering(self, dataset_id: str, algorithm: str) -> dict:
        entry = self.resolve(dataset_id)
        if not entry.get("results_path"):
            raise DatasetError(f"dataset '{dataset_id}' has no result files")
        road_ids = {f["properties"]["road_id"]
                    for f in self.geometry(dataset_id)["roads"]["features"]}
        result = ds.load_numbering(entry["results_path"], algorithm, road_ids)
        result["dataset_id"] = dataset_id
        return result

    def invalidate(self) -> None:
        with self._lock:
            self._geometry_cache.clear()

    # -- uploads -----------------------------------------------------------

    def save_upload(self, payload: dict) -> dict:
        files = payload.get("files") or []
        if not files:
            raise DatasetError("no files were included in the upload")

        upload_id = f"{_slug(payload.get('name') or 'dataset')}-{uuid.uuid4().hex[:6]}"
        base = os.path.join(self.upload_root, upload_id)
        net_dir = os.path.join(base, "network")
        res_dir = os.path.join(base, "results")
        os.makedirs(net_dir, exist_ok=True)
        os.makedirs(res_dir, exist_ok=True)

        written, total = [], 0
        try:
            for item in files:
                name = _slug(posixpath.basename(item.get("path") or item.get("name") or ""))
                if not name:
                    continue
                try:
                    blob = base64.b64decode(item.get("data") or "", validate=True)
                except (ValueError, TypeError):
                    raise DatasetError(f"file '{name}' was not valid base64")
                total += len(blob)
                if total > MAX_UPLOAD_BYTES:
                    raise DatasetError("upload exceeds the 128 MB limit")
                target_dir = res_dir if name.lower().endswith(".csv") else net_dir
                with open(os.path.join(target_dir, name), "wb") as fh:
                    fh.write(blob)
                written.append(name)

            # Fail early with a clear message rather than at first render.
            record = ds.describe(net_dir, res_dir,
                                 city=payload.get("city") or "Uploaded",
                                 network=payload.get("network") or payload.get("name")
                                 or upload_id)
            network = ds.load_network(net_dir)
        except Exception:
            shutil.rmtree(base, ignore_errors=True)
            raise

        manifest = {
            "city": record["city"],
            "network": record["network"],
            "uploaded_at": _now(),
            "files": written,
            "stats": network["stats"],
        }
        with open(os.path.join(base, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)

        self.invalidate()
        record["id"] = f"uploads/{upload_id}"
        record["source"] = "uploaded"
        record["stats"] = network["stats"]
        return {k: v for k, v in record.items() if k not in ("path", "results_path")}

    # -- event log ---------------------------------------------------------

    def append_events(self, events: list[dict], context: dict) -> int:
        """Append interaction/feedback events as newline-delimited JSON.

        This is the seed of objective 4: every pan, zoom, road click and
        (later) questionnaire answer lands here with a timestamp, ready for
        offline analysis.
        """
        if not events:
            return 0
        os.makedirs(os.path.dirname(self.log_path) or ".", exist_ok=True)
        received = _now()
        with self._lock, open(self.log_path, "a", encoding="utf-8") as fh:
            for event in events:
                if not isinstance(event, dict):
                    continue
                record = {"received_at": received, **context, **event}
                fh.write(json.dumps(record, default=str) + "\n")
        return len(events)

    def read_events(self, limit: int = 1000) -> list[dict]:
        if not os.path.exists(self.log_path):
            return []
        with self._lock, open(self.log_path, encoding="utf-8") as fh:
            lines = fh.readlines()
        out = []
        for line in lines[-limit:]:
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return out


def _slug(text: str) -> str:
    return _SAFE_NAME.sub("_", (text or "").strip()).strip("._-")[:120]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Handler(SimpleHTTPRequestHandler):
    store: Store  # injected below

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    # -- routing -----------------------------------------------------------

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._route_get(path)
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/upload":
                body = self._read_json()
                self._send_json(self.store.save_upload(body), status=201)
            elif path == "/api/events":
                body = self._read_json()
                context = {
                    "session_id": body.get("session_id"),
                    "participant_id": body.get("participant_id"),
                }
                count = self.store.append_events(body.get("events") or [], context)
                self._send_json({"stored": count})
            else:
                self._send_error(404, f"no such endpoint: {path}")
        except DatasetError as exc:
            self._send_error(400, str(exc))
        except ValueError as exc:
            self._send_error(400, f"malformed request: {exc}")
        except Exception as exc:  # pragma: no cover - surfaced to the browser
            self._send_error(500, f"{type(exc).__name__}: {exc}")

    def _route_get(self, path: str) -> None:
        parts = [unquote(p) for p in path.strip("/").split("/")[1:]]
        try:
            if parts == ["datasets"]:
                self._send_json({"datasets": self.store.catalogue()})
                return
            if parts == ["events"]:
                self._send_json({"events": self.store.read_events()})
                return
            if parts == ["health"]:
                self._send_json({"ok": True, "time": _now()})
                return
            if len(parts) == 3 and parts[0] == "datasets":
                self._send_json(self.store.geometry("/".join(parts[1:3])))
                return
            if len(parts) == 5 and parts[0] == "datasets" and parts[3] == "numbering":
                self._send_json(self.store.numbering("/".join(parts[1:3]), parts[4]))
                return
            self._send_error(404, f"no such endpoint: {path}")
        except DatasetError as exc:
            self._send_error(404, str(exc))
        except Exception as exc:  # pragma: no cover - surfaced to the browser
            self._send_error(500, f"{type(exc).__name__}: {exc}")

    # -- helpers -----------------------------------------------------------

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_UPLOAD_BYTES * 2:
            raise DatasetError("request body is too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, message: str) -> None:
        self._send_json({"error": message, "status": status}, status=status)

    def end_headers(self) -> None:
        # Static assets are edited constantly during development; never let the
        # browser serve a stale copy.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", default=os.path.join(ROOT, "data"))
    parser.add_argument("--results", default=os.path.join(ROOT, "results"))
    parser.add_argument("--uploads", default=os.path.join(ROOT, "uploads"))
    parser.add_argument("--log", default=os.path.join(ROOT, "logs", "events.jsonl"))
    args = parser.parse_args()

    Handler.store = Store(args.data, args.results, args.uploads, args.log)

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print(f"cannot bind {args.host}:{args.port} - {exc}", file=sys.stderr)
        return 1

    catalogue = Handler.store.catalogue()
    print("\n  Road Numbering Evaluation Interface")
    print(f"  http://{args.host}:{args.port}\n")
    print(f"  data      {args.data}")
    print(f"  results   {args.results}")
    print(f"  event log {args.log}")
    print(f"  {len(catalogue)} dataset(s) available:")
    for entry in catalogue:
        print(f"    - {entry['id']:<22} {len(entry['algorithms'])} algorithm outputs")
    print("\n  Ctrl-C to stop\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
