#!/usr/bin/env bash
# Run the Azure migration job on the published image and fail unless it succeeds.
# The workflow bounds the total wait with timeout-minutes.
set -euo pipefail
: "${JOB:?Set JOB}"
: "${RG:?Set RG}"
: "${IMAGE:?Set IMAGE}"

az containerapp job update -n "$JOB" -g "$RG" --image "$IMAGE" -o none
run=$(az containerapp job start -n "$JOB" -g "$RG" --query name -o tsv)
if [ -z "$run" ] || [ "$run" = None ] || [ "$run" = null ]; then
  echo "::error::Azure returned no migration execution name."
  exit 1
fi
echo "Execution: $run"

while true; do
  status=$(az containerapp job execution show -n "$JOB" -g "$RG" \
    --job-execution-name "$run" --query properties.status -o tsv)
  case "$status" in
    Succeeded) break ;;
    Running|Processing) sleep 10 ;;
    *)
      echo "::error::Migration $run ended with status '$status'; release stopped. Logs: az containerapp job logs show -n $JOB -g $RG --execution $run --container $JOB"
      exit 1
      ;;
  esac
done
