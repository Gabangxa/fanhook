#!/bin/bash
set -e

# Install dependencies if package-lock.json or package.json changed.
# `npm install` is idempotent — running it again is a no-op when nothing changed.
npm install --no-audit --no-fund --no-progress
