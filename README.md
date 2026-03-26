# Broken Website Detector

Broken Website Detector is a Chrome Extension built with Manifest V3 that analyzes the active business website and flags practical issues that often signal weak quality, poor conversion paths, weak trust, lightweight SEO problems, or mobile friction.

It is designed for freelancers, agencies, consultants, and sales teams who want a fast, browser-native prospecting tool for spotting websites that may be good candidates for redesign, optimization, or outreach.

## What It Does

When you open the popup on a normal website, the extension:

- analyzes the active tab
- extracts DOM and metadata signals locally in the browser
- scores the page from 0 to 100
- classifies it as Poor, Medium, or Strong
- groups issues by category
- suggests high-value improvements
- estimates a rough monthly business opportunity range
- generates a ready-to-copy outreach message

## Scoring Model

Each category starts at 100 and loses points when issues are detected. Scores are clamped to 0-100.

Weighted final score:

- Design / Structure: 25%
- Conversion / Trust: 35%
- Technical / SEO: 25%
- Mobile Optimization: 15%

Quality bands:

- 0-40 = Poor
- 41-70 = Medium
- 71-100 = Strong

## Heuristics Used

This extension is intentionally practical rather than academically perfect. Version 1 uses browser-side heuristics instead of external APIs or a backend.

### Design / Structure

Checks include:

- missing H1
- multiple H1 headings
- weak heading order
- no obvious hero section
- too many font families
- low text contrast risk based on sampled computed styles
- weak visual hierarchy based on relative heading and body sizes
- small body text
- too many above-the-fold interactive elements
- no clear CTA near the top

Hero detection is heuristic. It looks for an opening section with a large heading plus some combination of supporting text, CTA, media, and section size.

CTA detection is heuristic. It uses lowercase partial matching against terms such as:

- contact
- book
- buy
- shop
- get started
- request
- call
- schedule
- quote
- consultation
- demo
- start
- sign up
- learn more

### Conversion / Trust

Checks include:

- missing phone number
- missing email
- missing contact form
- no testimonials or reviews
- no trust badges, guarantees, partner cues, or similar signals
- no visible pricing or package clarity when the page appears commercially intent-driven
- no FAQ section
- weak social proof
- no address for likely local businesses
- no CTA above the fold

These are heuristic detections based on visible patterns, keyword matching, structure, and contact markup.

### Technical / SEO

Checks include:

- missing or weak title tag
- missing meta description
- missing viewport meta tag
- images without alt text
- very large image count
- same-origin internal links returning error responses
- heuristic performance risk
- missing `lang`
- missing canonical tag
- missing Open Graph tags
- form controls without labels

Performance is heuristic in version 1. It uses browser timing and page complexity indicators such as:

- DOMContentLoaded timing
- load timing
- script count
- stylesheet count
- DOM node count
- image count

It does not claim Lighthouse scores or Core Web Vitals.

### Mobile Optimization

Checks include:

- missing viewport meta tag
- horizontal overflow risk
- touch targets below 44px
- text that may be too small for mobile
- elements wider than the viewport
- buttons too close together
- fixed-width container risk

These signals are calculated against the page as currently rendered in the browser. They are useful heuristics, but they are not a substitute for full device testing.

## Broken Link Validation Limits

Broken link validation is intentionally limited.

- only same-origin internal links are checked
- only a small sample is checked for performance
- external links are not claimed as verified
- some links may be marked as `unchecked` when servers block requests or respond in ways that are not reliable for lightweight validation

This keeps the extension honest and fast.

## Business Opportunity Estimate

The Business Opportunity section is a prospecting heuristic, not factual revenue analytics.

It estimates a rough monthly loss range based on issues such as:

- missing CTA
- weak trust signals
- missing testimonials
- missing contact paths
- mobile usability problems
- weak performance
- missing pricing clarity

The estimate is intentionally framed as:

- rough
- directional
- useful for outreach prioritization
- not a verified financial claim

## Privacy

Version 1 is fully local.

- no external paid APIs
- no backend
- no analytics calls
- no page data leaves the browser

The extension reads the current page locally, computes heuristics locally, and renders the report locally.

## Files

- `manifest.json` - Manifest V3 configuration
- `popup.html` - popup markup
- `popup.css` - popup UI styles
- `popup.js` - popup orchestration, scoring, reporting, copy utilities
- `content.js` - page extraction and heuristic signal collection
- `background.js` - same-origin internal link validation

## Setup

1. Download or clone this folder locally.
2. Open Chrome, Chromium, or another Chromium-based browser.
3. Go to `chrome://extensions/`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select this project folder.

## How To Load In ChatGPT Atlas

Atlas uses the normal Chromium extension model, so the process is the same conceptually:

1. Open the browser extension management page available in Atlas.
2. Enable developer or unpacked extension loading if your environment exposes it.
3. Load this project folder as a standard Chrome extension.
4. Open a website and click the extension icon to run the analysis.

This extension is built as a normal Chrome extension, not an Atlas-specific SDK app.

## Using The Extension

1. Open a business website in a tab.
2. Click the Broken Website Detector extension icon.
3. Wait for the popup analysis to finish.
4. Review the score, issues, suggestions, and business opportunity estimate.
5. Use Copy message to grab the outreach note.
6. Use Copy full report for a longer summary.

## Known Limitations

- Browser internal pages such as `chrome://` cannot be analyzed.
- Some sites block script injection or expose very limited readable DOM content.
- Console error counts are not captured in version 1.
- Mobile checks are heuristic and based on the current rendered layout, not real multi-device emulation.
- Internal link validation is sampled and can return `unchecked`.
- Decorative images with intentionally empty alt text can be hard to distinguish from missing content alt text.
- Pricing and local-business detection are best-effort heuristics, not guaranteed business classification.

## Notes For Extension Review

The broad host permission is included so the background service worker can validate same-origin internal links on arbitrary websites. Version 1 still limits validation to a small number of same-origin URLs from the currently analyzed page.
