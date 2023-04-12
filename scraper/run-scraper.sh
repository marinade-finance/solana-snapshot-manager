#!/bin/bash

set -ex
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 400405091548.dkr.ecr.eu-central-1.amazonaws.com
docker compose rm -f -s -v
docker compose up -d