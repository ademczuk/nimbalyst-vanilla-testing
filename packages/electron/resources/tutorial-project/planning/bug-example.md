---
bugStatus:
  title: Export remains disabled after changing the date range
  status: to-do
  priority: medium
  owner: tutorial
  description: The dashboard export control does not refresh after a custom date range is selected.
  tags: [tutorial, dashboard]
---

# Export remains disabled after changing the date range

## What happened

The dashboard recognizes the new range and redraws the chart, but the export control remains disabled until the file is reopened.

## Steps to reproduce

1. Open the dashboard.
2. Change the reporting period from the default six months to a custom range.
3. Wait for the chart to refresh.
4. Check the export control.

## Expected

The export control becomes available as soon as the refreshed data is ready.

## Actual

The chart updates, but the export control remains disabled.

## Acceptance check

Add a focused regression test that changes the date range and verifies the export control becomes available without reopening the file.
