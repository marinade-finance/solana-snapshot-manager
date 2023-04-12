#!/bin/bash

set -ex
docker compose rm -f -s -v
docker compose up -d