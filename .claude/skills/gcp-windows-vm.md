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

RDP and SSH access is restricted for security. The following rules are in place:

| Rule | Protocol/Port | Source | Purpose |
|------|--------------|--------|---------|
| `default-allow-rdp` | TCP 3389 | `150.117.242.93/32` | RDP access for authorized IP only |
| `default-allow-ssh` | TCP 22 | `35.235.240.0/20` | SSH via GCP IAP only |

**Important**: The old `allow-rdp` rule (which allowed `0.0.0.0/0`) was deleted on 2026-02-24 as a security fix (#134).

If your IP changes, update the RDP rule with your new IP:

```bash
gcloud config configurations activate lingoleap

# Update RDP rule with new IP (replace YOUR_IP with your current public IP)
gcloud compute firewall-rules update default-allow-rdp \
  --source-ranges="YOUR_IP/32" \
  --project lingoleap-dev

# Check your current public IP
curl -s ifconfig.me
```

**Never set source-ranges to `0.0.0.0/0` — open RDP is scanned 24/7 by brute-force bots.**

## Cost Estimate

- ~$25/month if running 24/7
- With auto-shutdown at 23:00, cost depends on daily usage hours
- **Remember**: VM is stopped nightly — must manually start each day
