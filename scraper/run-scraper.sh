#!/bin/bash

set -ex

if grep -qs '/mnt/data ' /proc/mounts; then
    echo "Volume it's already mounted."
else
    sudo mkfs -t ext4 /dev/nvme1n1
    sudo mount /dev/nvme1n1 /mnt/data
fi

aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 400405091548.dkr.ecr.eu-central-1.amazonaws.com
docker compose rm -f -s -v
docker compose up -d