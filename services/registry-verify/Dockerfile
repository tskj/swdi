# The registry re-verification cron: a tiny image with just the script and the data.
# Railway runs it on the schedule in railway.registry-verify.json; a non-zero exit
# (broken links) shows up as a failed run in the dashboard.
FROM node:24-slim

WORKDIR /app
COPY registry/registry.json registry/registry.json
COPY scripts/verify-registry.mjs scripts/verify-registry.mjs

CMD ["node", "scripts/verify-registry.mjs"]
