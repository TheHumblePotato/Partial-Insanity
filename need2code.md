# Need to Code

## BUGS

1. reporting issue doesn't make it show up in "My Submitted Issues"
2. admin issues page doesnt work

## Visual

1. locks don't looks good
2. need better background
3. aethetic stuff

## Suggestions/Features

1. settings page for team
2. show answers only on toggle
3. secure and move admin panel
4. change the hints from 10 total hints to 1 hint per day

## Puzzle Stuff

[Resolved]

## Admin / Site

- Added an admin **Rules editor** (Markdown) with live preview — stored in Firestore at `site/rules`.
- Replaced inline `adminLogin()` onclick binding with a resilient DOM-bound handler to avoid the "adminLogin is not defined" runtime error.