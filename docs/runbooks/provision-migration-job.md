# Publishing cannot reach the production migration job

**Use when:** configuring image publishing and migrations for the first time,
or restoring the migration job after its resources were removed.
**Last drilled:** never against Azure; the image and migration gate are checked locally and in CI.

Azure execution is currently commented out in `deploy.yml`; the active pipeline
only tests and publishes to GHCR. This procedure applies when Azure deployment
work resumes and those steps are enabled; publishing does not require it.

## Before you start

- Sign in with `az login` and `gh auth login`.
- Have an existing Azure resource group and Container Apps environment, a
  Postgres connection URL that permits access from that environment, and
  permission to register an Entra application and assign resource-group roles.
- Have admin access to the GitHub repository and its GHCR package visibility.
- Blast radius: creates a deployment identity and migration job; triggering
  the workflow applies pending SQL migrations to the configured database.

## Steps

1. Set the resource names for the existing environment:
   ```bash
   RG=<resource-group>
   ENV=<container-apps-environment>
   APP=<web-container-app-name>
   REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
   az extension add --name containerapp --upgrade
   az containerapp env show -n "$ENV" -g "$RG" -o none
   ```
2. Create the identity for GitHub Actions, scoped to this resource group:
   ```bash
   CLIENT_ID=$(az ad app create --display-name gh-ingredia-deploy --query appId -o tsv)
   az ad sp create --id "$CLIENT_ID"
   az role assignment create --assignee "$CLIENT_ID" --role Contributor \
     --scope "$(az group show -n "$RG" --query id -o tsv)"
   az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
     \"name\": \"deploy-from-main\",
     \"issuer\": \"https://token.actions.githubusercontent.com\",
     \"subject\": \"repo:$REPO:ref:refs/heads/main\",
     \"audiences\": [\"api://AzureADTokenExchange\"]}"
   ```
3. Set the workflow's repository variables:
   ```bash
   gh variable set AZURE_CLIENT_ID --body "$CLIENT_ID"
   gh variable set AZURE_TENANT_ID --body "$(az account show --query tenantId -o tsv)"
   gh variable set AZURE_SUBSCRIPTION_ID --body "$(az account show --query id -o tsv)"
   gh variable set AZURE_RESOURCE_GROUP --body "$RG"
   gh variable set AZURE_CONTAINERAPP --body "$APP"
   ```
4. Read the production database URL without echoing it and create the job:
   ```bash
   read -r -s -p 'DATABASE_URL: ' DATABASE_URL
   printf '\n'
   az containerapp job create -n "$APP-migrate" -g "$RG" --environment "$ENV" \
     --trigger-type Manual --replica-timeout 600 --replica-retry-limit 0 \
     --parallelism 1 --replica-completion-count 1 --cpu 0.5 --memory 1Gi \
     --image mcr.microsoft.com/k8se/quickstart-jobs:latest \
     --command /app/apps/migrate/node_modules/.bin/tsx \
     --args /app/apps/migrate/src/index.ts \
     --secrets database-url="$DATABASE_URL" \
     --env-vars DATABASE_URL=secretref:database-url
   unset DATABASE_URL
   ```
5. When Azure deployment work resumes, enable the commented Azure steps and
   permissions in both the caller and publishing workflows. Merge the changes
   to main; CI calls the publishing workflow after both check jobs succeed.
6. If the first migration execution cannot pull the image, open the
   repository's GitHub Packages page, select the `web` image, and change its
   visibility to Public. The first published package is private by default.
   Re-run the failed workflow after changing visibility.
7. Inspect the workflow with `gh run list --workflow ci.yml` and
   `gh run view <run-id> --log-failed`.

## Verify it worked

1. Confirm the package contains a tag equal to the workflow's full commit SHA.
2. Confirm the migration job execution reports `Succeeded`:
   ```bash
   az containerapp job execution list -n "$APP-migrate" -g "$RG" -o table
   ```
3. Confirm the job uses that exact published image:
   ```bash
   az containerapp job show -n "$APP-migrate" -g "$RG" \
     --query properties.template.containers[0].image -o tsv
   ```
4. Confirm no web revision is created; this workflow publishes and migrates
   only. Rollout is a separate step.

## If this didn't work

1. Read execution logs with `az containerapp job logs show -n "$APP-migrate"
   -g "$RG" --container "$APP-migrate"`.
2. For connection failures, check the job's secret reference and database
   networking. Do not open the database firewall to everyone.
3. For failed SQL, inspect the failed migration before rerunning. Completed
   migrations are not automatically rolled back; applied files are append-only.
4. If the workflow times out, check whether the Azure execution is still
   running before starting another; a runner timeout does not stop the Azure job.

## Related

- [Deploy contract](../specs/deploy.md)
