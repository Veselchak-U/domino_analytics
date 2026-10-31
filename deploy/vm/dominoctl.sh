#!/usr/bin/env bash
set -euo pipefail
usage() { echo "Usage: DOMINO_DEPLOY_DIR=/path bash dominoctl.sh {install|update} <release-directory> | {rollback|status|logs|stop|verify}" >&2; exit 64; }
[[ $# -ge 1 ]] || usage
action="$1"
case "$action" in
  install|update) [[ $# -eq 2 ]] || usage ;;
  rollback|status|logs|stop|verify) [[ $# -eq 1 ]] || usage ;;
  *) usage ;;
esac
for command in docker flock sha256sum; do
  command -v "$command" >/dev/null || { echo "Не найдена команда: $command" >&2; exit 1; }
done
docker compose version >/dev/null
deploy_dir="${DOMINO_DEPLOY_DIR:-$HOME/domino}"
mkdir -p -- "$deploy_dir"
deploy_dir="$(cd -- "$deploy_dir" && pwd)"
exec 9>"$deploy_dir/.deploy.lock"
flock -n 9 || { echo "Другая операция уже выполняется" >&2; exit 1; }
export DOMINO_DATA_DIR="$deploy_dir/data"
mkdir -p -- "$DOMINO_DATA_DIR/examples" "$deploy_dir/releases" "$deploy_dir/backups"
if [[ "$EUID" -eq 0 ]]; then chown 1000:1000 "$DOMINO_DATA_DIR"; fi

compose() {
  local release="$1" image
  shift
  image="$(cut -d= -f2 "$release/image.env")"
  DOMINO_IMAGE="$image" docker compose -p domino-analytics --env-file "$release/image.env" -f "$release/compose.yaml" "$@"
}
active() {
  local name="$1" version
  [[ -f "$deploy_dir/$name" && ! -L "$deploy_dir/$name" ]] || return 1
  version="$(cat -- "$deploy_dir/$name")"
  [[ "$version" =~ ^[a-z0-9][a-z0-9_.-]{0,63}$ && -f "$deploy_dir/releases/$version/image.env" ]] || return 1
  printf '%s/releases/%s\n' "$deploy_dir" "$version"
}
point() { printf '%s\n' "${2##*/}" > "$deploy_dir/$1.next"; mv -f -- "$deploy_dir/$1.next" "$deploy_dir/$1"; }
start() { compose "$1" up -d --no-build --pull never --wait --wait-timeout 90; }
verify_release() {
  local directory="$1" file
  for file in image.tar compose.yaml image.env dominoctl.sh smoke.mjs SHA256SUMS; do
    [[ -f "$directory/$file" && ! -L "$directory/$file" ]] || { echo "Нет обычного файла релиза: $file" >&2; return 1; }
  done
  # Check only the fixed allowlist; do not interpret a supplied manifest as commands or paths.
  [[ "$(wc -l < "$directory/SHA256SUMS")" -eq 5 ]] || return 1
  for file in image.tar compose.yaml image.env dominoctl.sh smoke.mjs; do
    local expected actual
    expected="$(awk -v file="$file" '$2 == file || $2 == "*" file {print $1}' "$directory/SHA256SUMS")"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || return 1
    actual="$(sha256sum "$directory/$file")"
    [[ "${actual%% *}" == "$expected" ]] || { echo "Повреждён файл: $file" >&2; return 1; }
  done
  [[ "$(wc -l < "$directory/image.env")" -eq 1 ]] || return 1
  grep -Eq '^DOMINO_IMAGE=domino-analytics:[a-z0-9][a-z0-9_.-]{0,63}$' "$directory/image.env"
}

current="$(active current || true)"
if [[ -e "$deploy_dir/current" && -z "$current" ]]; then
  echo "Повреждён указатель текущего релиза; проверьте $deploy_dir/current" >&2
  exit 1
fi
case "$action" in
  status|logs|stop|verify)
    [[ -n "$current" ]] || { echo "Приложение ещё не установлено" >&2; exit 1; }
    case "$action" in
      status) compose "$current" ps ;;
      logs) compose "$current" logs --tail 100 ;;
      stop) compose "$current" stop ;;
      verify) compose "$current" exec -T app node --input-type=module < "$current/smoke.mjs" ;;
    esac
    exit 0 ;;
  install) [[ -z "$current" ]] || { echo "Уже установлено: используйте update" >&2; exit 1; } ;;
  update) [[ -n "$current" ]] || { echo "Сначала выполните install" >&2; exit 1; } ;;
esac

if [[ "$action" == rollback ]]; then
  target="$(active previous || true)"
  [[ -n "$current" && -n "$target" ]] || { echo "Нет предыдущего релиза" >&2; exit 1; }
  verify_release "$target"
  docker load -i "$target/image.tar"
  compose "$target" config --quiet
else
  source_dir="$(cd -- "$2" && pwd)"
  verify_release "$source_dir" || { echo "Проверка релиза не пройдена; текущий запуск сохранён" >&2; exit 1; }
  image="$(cut -d= -f2 "$source_dir/image.env")"
  version="${image#domino-analytics:}"
  target="$deploy_dir/releases/$version"
  if [[ -e "$target" ]]; then
    cmp -s -- "$source_dir/SHA256SUMS" "$target/SHA256SUMS" || { echo "Версия уже занята другим содержимым" >&2; exit 1; }
    verify_release "$target"
  else
    mkdir -- "$target"
    cp -- "$source_dir/"{image.tar,compose.yaml,image.env,dominoctl.sh,smoke.mjs,SHA256SUMS} "$target/"
  fi
  # Load and validate configuration before replacing the running service.
  docker load -i "$target/image.tar"
  compose "$target" config --quiet
fi

if [[ "$target" == "$current" ]]; then
  start "$target"
  echo "Эта версия установлена и запущена"
  exit 0
fi
if [[ -n "$current" ]]; then
  backup="$deploy_dir/backups/examples-$(date -u +%Y%m%dT%H%M%S)-$$.tar.gz"
  tar -czf "$backup" -C "$DOMINO_DATA_DIR" examples
  echo "Копия примеров: $backup. Текущий расчёт будет прерван; готовые результаты сохраняются в SQLite."
fi
if start "$target"; then
  [[ -z "$current" ]] || point previous "$current"
  point current "$target"
  echo "Установлен здоровый релиз: $(basename -- "$target")"
else
  echo "Новый релиз не прошёл проверку здоровья" >&2
  if [[ -n "$current" ]]; then
    if start "$current"; then echo "Предыдущая версия восстановлена" >&2
    else echo "ОТКАТ НЕ УДАЛСЯ. Проверьте контейнер и logs; данные не удалялись." >&2; fi
  else
    compose "$target" stop || true
  fi
  exit 1
fi
