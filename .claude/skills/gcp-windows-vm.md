# GCP Windows Test VM

## Overview
Windows Server 2022 VM for testing website rendering (text colors, fonts) on Windows + Chrome.

## VM Details

| Item | Value |
|------|-------|
| Name | `windows-test` |
| Zone | `asia-east1-b` |
| Machine Type | `e2-medium` (2 vCPU / 4GB RAM) |
| OS | Windows Server 2022 |
| External IP | `34.81.253.196` |
| RDP Username | `young` |
| RDP Password | See `.env` → `GCP_VM_WINDOWS_PASSWORD` |
| GCP Project | `lingoleap-dev` |
| Installed Software | Chrome |

## Auto-Shutdown Schedule

- **Cloud Scheduler Job**: `stop-windows-test-nightly`
- **Schedule**: Every day at **23:00 Taipei time** (cron: `0 23 * * *`)
- **Action**: Auto-stops the VM to save costs

## Commands

```bash
# Activate gcloud config first
gcloud config configurations activate lingoleap

# Start VM
gcloud compute instances start windows-test --zone=asia-east1-b --project lingoleap-dev

# Stop VM
gcloud compute instances stop windows-test --zone=asia-east1-b --project lingoleap-dev

# Check VM status
gcloud compute instances describe windows-test --zone=asia-east1-b --project lingoleap-dev --format="value(status)"

# Reset Windows password (if needed)
gcloud compute reset-windows-password windows-test --zone=asia-east1-b --project lingoleap-dev --user=young

# Check scheduler job
gcloud scheduler jobs describe stop-windows-test-nightly --location=asia-east1 --project lingoleap-dev
```

## RDP Connection

Use **Microsoft Remote Desktop** (Mac App Store) or GCP Console browser RDP.
- Host: `34.81.253.196`
- Username: `young`
- Password: from `.env`

## Firewall

- Rule `allow-rdp`: TCP 3389 open from `0.0.0.0/0` (all IPs)

## Cost Estimate

- ~$25/month if running 24/7
- With auto-shutdown at 23:00, cost depends on daily usage hours
- **Remember**: VM is stopped nightly — must manually start each day
