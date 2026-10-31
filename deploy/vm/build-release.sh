#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 || ! "$1" =~ ^[a-z0-9][a-z0-9_.-]{0,63}$ ]]; then
  echo "Usage: bash deploy/vm/build-release.sh <version> <new-output-directory>" >&2
  exit 64
fi
version="$1"
output="$2"
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -e "$output" ]]; then echo "Каталог релиза уже существует: $output" >&2; exit 1; fi
docker info >/dev/null
mkdir -p -- "$output"
output="$(cd -- "$output" && pwd)"
image="domino-analytics:$version"
docker build --platform linux/amd64 -f "$root/deploy/vm/Dockerfile" -t "$image" "$root"
docker save -o "$output/image.tar" "$image"
printf 'DOMINO_IMAGE=%s\n' "$image" > "$output/image.env"
cp -- "$root/deploy/vm/compose.yaml" "$root/deploy/vm/dominoctl.sh" "$root/deploy/vm/smoke.mjs" "$output/"
(cd -- "$output" && sha256sum image.tar compose.yaml image.env dominoctl.sh smoke.mjs > SHA256SUMS)
echo "Релиз готов: $output. Передайте весь каталог на локальную VM по SCP."
