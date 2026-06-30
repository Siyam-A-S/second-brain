# Second Brain macOS Beta Testing Guide

This build is ad-hoc signed for beta testing. Because it was prepared outside the Apple Developer notarization flow, macOS Gatekeeper may initially block it as coming from an unidentified developer.

## Install

1. Download the `.dmg` file.
2. Double-click the `.dmg` to mount it.
3. Drag `Second Brain.app` into the `Applications` folder.
4. Eject the mounted disk image.

## First Launch

1. Open `Applications`.
2. Double-click `Second Brain.app`.
3. When macOS shows the unidentified developer warning, click `Cancel`.
4. Do not click `Move to Trash`.

## Allow In System Settings

1. Open macOS `System Settings`.
2. Go to `Privacy & Security`.
3. Scroll down to the `Security` section.
4. Look for the note saying `Second Brain` was blocked from use because it is from an unidentified developer.
5. Click `Open Anyway`.
6. Enter your Mac administrator password if prompted.
7. On the final confirmation prompt, click `Open`.

After this one-time approval, `Second Brain` should open normally from `Applications`.

## If It Still Does Not Open

1. Make sure the app was copied to `Applications`, not launched directly from the `.dmg`.
2. Try opening it again from `Applications`.
3. Return to `System Settings` -> `Privacy & Security` and check whether another `Open Anyway` prompt appeared.
4. Send the tester notes, macOS version, Mac model, and a screenshot of the warning back to the developer.
