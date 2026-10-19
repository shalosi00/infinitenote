# InfiniteNote — developer commands
# Toolchain: bun 1.3+ (https://bun.sh)

.PHONY: dev test lint typecheck build start e2e status help

dev:            ## Run the app in dev mode (http://localhost:3000)
	bun run dev

test:           ## Run the unit test suite
	bun test src/lib/__tests__

lint:           ## Run ESLint
	bun run lint

typecheck:      ## Generate Prisma client types, then typecheck the app
	bun run db:generate && bunx tsc --noEmit

build:          ## Production build (standalone)
	bun run build

start:          ## Boot the production server (after `make build`)
	bun run start

e2e:            ## Run the E2E suite (needs `make dev` running on :3000)
	bash scripts/e2e.sh

status:         ## Print a quick project status snapshot
	bash scripts/status.sh

help:           ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
