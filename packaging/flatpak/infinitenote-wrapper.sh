#!/bin/sh
# InfiniteNote flatpak launcher. The bundle ships the upstream AppImage via
# extra-data; AppImages cannot FUSE-mount inside the flatpak sandbox, so we
# use extract-and-run.
exec /app/extra/InfiniteNote.AppImage --appimage-extract-and-run "$@"
