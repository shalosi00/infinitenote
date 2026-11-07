#!/usr/bin/env python3
"""Tiny CORS-enabled static server for e2e fixtures (human-test helper)."""
import http.server
import socketserver
import os

os.chdir("/home/z/my-project/e2e/fixtures")


class CORS(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8799), CORS) as httpd:
    httpd.serve_forever()
