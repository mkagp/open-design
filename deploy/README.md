# Docker deployment

This deployment ships Open Design as a single Alpine-based runtime image. The
daemon serves both the API and the built Next.js static export, so there is no
separate nginx container.

## Local compose

Before starting:

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Generate a secure token:

   ```bash
   openssl rand -hex 32
   ```

3. Open `.env` in your editor, find `OD_API_TOKEN=`, and paste the generated token there.

Then pull and start the service:

```bash
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design:latest docker compose pull
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design:latest docker compose up -d --no-build
```

Defaults:

- Host port: `127.0.0.1:7456` (`OPEN_DESIGN_PORT=8080` to publish on `127.0.0.1:8080`)
- Runtime data volume: `open_design_data` mounted at `/app/.od`
- Node heap cap: `--max-old-space-size=192`
- Compose memory cap: `384m` (`OPEN_DESIGN_MEM_LIMIT=256m` to override)

Do not publish the daemon directly on a public or shared LAN interface. Remote
deployments should keep Compose bound to localhost and put a reverse proxy, SSH
tunnel, or VPN in front of it.

When exposing the service through an authenticated public IP, domain, or reverse
proxy, set `OPEN_DESIGN_ALLOWED_ORIGINS` to the browser origins that should be
allowed to call `/api`:

```bash
OPEN_DESIGN_ALLOWED_ORIGINS=https://od.example.com,http://203.0.113.10:7456 docker compose up -d --no-build
```

For the Clerk-hosted deployment at `https://design.mkagp.com`, keep Compose bound
to localhost, point the public reverse proxy at `127.0.0.1:7456`, and set:

```env
OD_AUTH_ENABLED=1
OD_PUBLIC_BASE_URL=https://design.mkagp.com
OPEN_DESIGN_ALLOWED_ORIGINS=https://design.mkagp.com
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
OD_AUTH_CLERK_ORG_ID=org_...
OD_AUTH_CLERK_DOMAIN=design.mkagp.com
OD_AUTH_PRIMARY_SIGN_IN_URL=https://login.mkagrowth.com/sign-in
OD_AUTH_PRIMARY_SIGN_UP_URL=https://login.mkagrowth.com/sign-up
OD_AUTH_COOKIE_SECRET=<openssl rand -hex 32>
OD_API_TOKEN=<machine token>
```

Clerk must have the configured `OD_AUTH_CLERK_DOMAIN` set up as a verified
satellite domain and must allow redirects back to `https://design.mkagp.com`.

Pin a specific published image with a digest instead of the mutable `latest` tag:

```bash
OPEN_DESIGN_IMAGE=docker.io/vanjayak/open-design@sha256:<digest> docker compose up -d --no-build
```
The image intentionally does not bundle Claude/Codex/Gemini CLI binaries. Keep
those outside the image, or build a separate private runtime layer if a server
deployment needs local code-agent CLIs installed in the container.

## Local CLI runtime image

For hosted deployments that need Local CLI mode inside Docker, build the larger
Debian-based runtime variant:

```env
OPEN_DESIGN_IMAGE=open-design-agent-clis:local
OPEN_DESIGN_DOCKERFILE=deploy/Dockerfile.agent-clis
OPEN_DESIGN_MEM_LIMIT=2g
NODE_OPTIONS=--max-old-space-size=512
```

Then rebuild and restart:

```bash
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
```

Docker image builds skip Next.js's in-build TypeScript validation to keep
low-memory hosts from stalling during `next build`. Run
`pnpm --filter @open-design/web typecheck` separately before publishing changes.

This variant installs exact npm package versions for:

- `@anthropic-ai/claude-code`
- `@openai/codex`
- `@google/gemini-cli`
- `opencode-ai`

The container remains read-only except for the existing `/app/.od` volume. CLI
home, auth, cache, and config paths are pointed under `/app/.od/home`, so sign-in
state survives container recreation through the same `open_design_data` volume
as the SQLite database.

Verify the binaries are visible to the daemon user:

```bash
docker compose -f deploy/docker-compose.yml exec open-design sh -lc \
  'which claude codex gemini opencode && echo "$HOME"'
```

The CLIs are bundled, but provider authentication still has to be completed or
configured for the container user. Use the app's Settings tests or each CLI's
own non-interactive/API-key auth path where supported. Compose passes through
these optional env vars when set in `deploy/.env`:

```env
OD_LOCAL_CLI_ALLOW_ENV_KEYS=1
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
OPENAI_API_KEY=
CODEX_API_KEY=
OPENAI_BASE_URL=
GEMINI_API_KEY=
GOOGLE_API_KEY=
```

After authentication is configured, confirm the daemon detects the bundled CLIs:

```bash
source deploy/.env
curl -sS \
  -H "Authorization: Bearer $OD_API_TOKEN" \
  http://127.0.0.1:${OPEN_DESIGN_PORT:-7456}/api/agents
```

## Publish to Docker Hub

```bash
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
IMAGE_NAMESPACE=your-dockerhub-user deploy/scripts/publish-images.sh --arch arm64
deploy/scripts/publish-images.sh --image docker.io/your-user/open-design:0.1.0
```

The script defaults to:

- `docker.io/vanjayak/open-design:<tag>`
- `linux/amd64,linux/arm64`
- `skopeo` push strategy with Docker credentials read from `~/.docker/config.json`
- preloading base images through `skopeo` to reduce Docker Hub pull flakiness

If `127.0.0.1:7890` is available and no proxy is already set, the script uses it
for registry access and passes `host.docker.internal:7890` into Docker builds. The
host-gateway alias is only added for builds that need this local proxy mapping.

### Colima swap helper for Apple Silicon

`deploy/scripts/prepare-colima-build-swap.sh` is for manual Docker image
publishing from an Apple Silicon macOS host that uses Colima as the Docker VM.
The helper is intentionally Apple Silicon-only because the failure mode it covers
is local arm64 Colima builds exhausting a small Linux VM while preparing
multi-arch images. It exits before touching Colima on non-macOS or
non-Apple-Silicon hosts.

Low-memory Colima VMs can run out of RAM during multi-arch image builds. The
helper checks the VM memory and swap status, then creates and enables a temporary
swap file only when the VM has no swap and less than 4 GiB of RAM. The 4 GiB
threshold is a conservative default for short-lived manual publishes on small
Colima profiles; raise `COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB` if larger builds
still OOM, or lower it if you only want swap for very small VMs.

Prefer increasing the Colima VM memory (`colima start --memory <GiB>` or the
profile config) when you want a persistent build machine. Use this helper when
you need a temporary, reversible boost for one manual publish without resizing
or recreating the VM.

Run it before a manual publish if Docker builds fail with out-of-memory errors,
or if `status` shows a small Colima VM with no swap. The swap remains active
until cleanup or VM restart, so use a shell trap for one-off sessions:

```bash
deploy/scripts/prepare-colima-build-swap.sh status
deploy/scripts/prepare-colima-build-swap.sh
trap 'deploy/scripts/prepare-colima-build-swap.sh cleanup' EXIT
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
COLIMA_BUILD_SWAP_SIZE=6G deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB=6291456 deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BIN=/opt/homebrew/bin/colima deploy/scripts/prepare-colima-build-swap.sh status
COLIMA_BUILD_SWAP_CLEANUP_FORCE=1 COLIMA_BUILD_SWAPFILE=/custom-swapfile deploy/scripts/prepare-colima-build-swap.sh cleanup
```

`cleanup` removes the default helper path and the old helper path. If you set a
custom `COLIMA_BUILD_SWAPFILE`, cleanup refuses to remove it unless
`COLIMA_BUILD_SWAP_CLEANUP_FORCE=1` is also set.
