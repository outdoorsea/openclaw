---
name: gastown
description: "Interface with Gas Town coding engine — dispatch work to the Mayor, send/read mail, check status"
metadata: {"openclaw":{"emoji":"⛽","requires":{"bins":["gastown"]}}}
---

# Gas Town Interface ⛽

Communicate with Gas Town's coding agents (Mayor, Polecats, Deacon) via the `gt` CLI.

## Identity

Myndy operates as an **overseer-agent** — Jeremy's AI delegate who can dispatch work and communicate with the Mayor and other Gas Town agents.

- **Profile**: `~/projects/rally-tavern/mayors/profiles/myndy.yaml`
- **Workspace**: `~/gt` (must cd here for gt commands)
- **Role**: Overseer-agent (bridges life management ↔ coding engine)

## Quick Reference

All commands must run from the Gas Town workspace:

```bash
cd ~/gt
```

### Check Status
```bash
gt status              # Overall town status
gt agents              # List running agent sessions
gt vitals              # Unified health dashboard
gt trail               # Recent agent activity
```

### Send Mail to Mayor
```bash
# Send a task
gt mail send mayor/ -s "Subject line" -m "Detailed message" --type task

# Send a notification
gt mail send mayor/ -s "FYI: context update" -m "Info here"

# Urgent task
gt mail send mayor/ -s "Critical fix needed" -m "Details" --urgent

# Check your inbox
gt mail inbox
```

### Dispatch Work
```bash
# Sling an issue to a rig (auto-spawns polecat)
gt sling <bead-id> <rig-name>

# Sling to the mayor directly
gt sling <bead-id> mayor

# Sling with a formula (workflow template)
gt sling <bead-id> <rig> --formula <formula-name>
```

### Beads (Work Items)
```bash
# Create a new bead (issue)
gt bead create -t "Title" -b "Description" --rig <rig-name>

# List beads
gt bead list

# Show a specific bead
gt show <bead-id>
```

### Convoy (Batch Tracking)
```bash
gt convoy list         # List active convoys
gt convoy show <id>    # Show convoy details
gt ready               # Show work ready across town
```

## Communication Protocol

When Myndy needs code work done:

1. **Create a bead** describing the work
2. **Sling it** to the appropriate rig or the Mayor
3. **Monitor** via `gt trail` and `gt convoy list`
4. **Read mail** for responses from the Mayor

When the Mayor needs context from Myndy:

1. Mayor sends mail to `--human` (reaches Jeremy/Myndy)
2. Myndy checks `gt mail inbox`
3. Myndy provides context from backends (memory, comms, PM, etc.)
4. Myndy replies via `gt mail reply`

## Rigs Available

| Rig | Repo | Prefix |
|-----|------|--------|
| myndy_monorepo | myndyaicom/myndyai | mm |
| myndy_pm | myndyaicom/myndyai | pm |

## Important Notes

- Always `cd ~/gt` before running gt commands
- The Mayor is a Claude Code agent — it understands code and git
- Polecats are worker agents spawned per-rig
- The Deacon handles background tasks
- Mail is git-native (stored in beads)
