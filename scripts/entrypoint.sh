#!/bin/sh
# Entrypoint do container: aplica as migrações, sobe a API e — se ela cair —
# mantém um servidor mínimo publicando o log do erro, para o diagnóstico não
# depender do coletor de logs da plataforma.
set -u
LOG=/tmp/estoqueflow-boot.log

{
  echo "=== EstoqueFlow · boot $(date -u +%FT%TZ) ==="
  echo "node: $(node -v)"
  echo "cwd:  $(pwd)"
  echo "dist: $(ls -l apps/api/dist/server.js 2>&1)"
  echo "web:  $(ls -l apps/web/dist/index.html 2>&1)"
  echo "--- prisma migrate deploy ---"
  npx --yes prisma migrate deploy 2>&1
  echo "MIGRATE_EXIT=$?"
  echo "--- iniciando a API ---"
} > "$LOG" 2>&1

cat "$LOG"

node apps/api/dist/server.js >> "$LOG" 2>&1 &
API_PID=$!

# aguarda a API responder; se responder, apenas acompanha o processo
i=0
while [ $i -lt 40 ]; do
  if node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] API respondeu em /health — tudo certo."
    tail -f "$LOG" &
    wait $API_PID
    exit $?
  fi
  kill -0 $API_PID 2>/dev/null || break
  i=$((i + 1))
  sleep 2
done

echo "[entrypoint] A API não subiu. Log completo abaixo e publicado em / para diagnóstico:"
cat "$LOG"

# mantém o container vivo servindo o log, para inspeção externa
exec node -e '
  const fs = require("fs");
  const p = process.env.PORT || 8080;
  const body = () => { try { return fs.readFileSync("/tmp/estoqueflow-boot.log","utf8"); } catch { return "sem log"; } };
  require("http").createServer((_q, s) => {
    s.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    s.end("EstoqueFlow nao subiu. Log de boot:\n\n" + body());
  }).listen(p, "::", () => console.log("[entrypoint] servidor de diagnostico em :" + p));
'
