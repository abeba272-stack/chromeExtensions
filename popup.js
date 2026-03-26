const CATEGORY_LABELS = {
  design: "Design / Structure",
  conversion: "Conversion / Trust",
  technical: "Technical / SEO",
  mobile: "Mobile Optimization"
};

const SCORE_WEIGHTS = {
  design: 0.25,
  conversion: 0.35,
  technical: 0.25,
  mobile: 0.15
};

const SEVERITY_ORDER = {
  high: 3,
  medium: 2,
  low: 1
};

const app = document.getElementById("app");

let currentReport = null;
let currentTab = null;

document.addEventListener("DOMContentLoaded", () => {
  analyzeActiveTab();
});

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined).format(value);
}

function formatCurrencyRange(minimum, maximum) {
  return `€${formatNumber(minimum)}-€${formatNumber(maximum)}`;
}

function getScoreStatus(score) {
  if (score <= 40) {
    return "Poor";
  }

  if (score <= 70) {
    return "Medium";
  }

  return "Strong";
}

function getScoreColor(score) {
  if (score <= 40) {
    return "var(--poor)";
  }

  if (score <= 70) {
    return "var(--medium)";
  }

  return "var(--strong)";
}

function renderLoadingState() {
  app.innerHTML = `
    <div class="loading">
      <div class="loading-card">
        <div class="shimmer shimmer-lg"></div>
      </div>
      <div class="loading-card">
        <div class="shimmer shimmer-md"></div>
      </div>
      <div class="loading-card">
        <div class="shimmer shimmer-sm"></div>
      </div>
    </div>
  `;
}

function renderStateCard(title, description, actions = "") {
  app.innerHTML = `
    <div class="state-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
      ${actions}
    </div>
  `;

  const analyzeButton = document.getElementById("retry-analysis");
  if (analyzeButton) {
    analyzeButton.addEventListener("click", () => analyzeActiveTab(true));
  }
}

function isUnsupportedUrl(url) {
  if (!url) {
    return true;
  }

  return /^(chrome|edge|about|brave|opera|vivaldi|moz-extension|chrome-extension|view-source):/i.test(
    url
  );
}

async function analyzeActiveTab(forceRefresh = false) {
  renderLoadingState();

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    if (!currentTab || !currentTab.id) {
      renderStateCard(
        "No active tab",
        "Open a website in the current window and try the analysis again."
      );
      return;
    }

    if (isUnsupportedUrl(currentTab.url)) {
      renderStateCard(
        "Page not supported",
        "This extension can only analyze normal web pages. Browser internal pages, settings pages, and extension pages cannot be inspected.",
        `
          <div class="footer-actions">
            <button id="retry-analysis" class="button-secondary">Analyze again</button>
          </div>
        `
      );
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"]
    });

    const response = await chrome.tabs.sendMessage(currentTab.id, {
      type: "BWD_ANALYZE_PAGE"
    });

    if (!response?.ok || !response.data) {
      throw new Error(response?.error || "The page did not return a readable analysis.");
    }

    const linkValidation = await validateLinks(response.data);
    const report = buildReport(response.data, linkValidation);
    currentReport = report;

    await chrome.storage.local.set({
      bwdLastReport: {
        url: report.pageInfo.url,
        generatedAt: report.generatedAt,
        report
      }
    });

    renderReport(report, forceRefresh);
  } catch (error) {
    renderStateCard(
      "Analysis unavailable",
      error?.message ||
        "This page could not be analyzed. Some pages block execution or expose very little readable content.",
      `
        <div class="footer-actions">
          <button id="retry-analysis" class="button-secondary">Analyze again</button>
        </div>
      `
    );
  }
}

async function validateLinks(snapshot) {
  const links = snapshot?.rawSignals?.links?.sampleInternalLinks || [];
  const origin = snapshot?.pageInfo?.origin;

  if (!origin || links.length === 0) {
    return {
      checkedCount: 0,
      limit: 25,
      summary: { valid: 0, broken: 0, unchecked: 0 },
      results: []
    };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BWD_VALIDATE_LINKS",
      origin,
      links
    });

    if (!response?.ok || !response.data) {
      throw new Error(response?.error || "link_validation_failed");
    }

    return response.data;
  } catch (error) {
    return {
      checkedCount: 0,
      limit: 25,
      summary: { valid: 0, broken: 0, unchecked: links.length },
      results: [],
      error: error?.message || "link_validation_failed"
    };
  }
}

function pushIssue(collection, issue) {
  collection.push(issue);
}

function buildReport(snapshot, linkValidation) {
  const signals = snapshot.rawSignals;
  const issues = [];
  const pageInfo = snapshot.pageInfo;

  const brokenLinks = linkValidation?.summary?.broken || 0;
  const uncheckedLinks = linkValidation?.summary?.unchecked || 0;

  if (signals.headings.levelCounts.h1 === 0) {
    pushIssue(issues, {
      id: "missing_h1",
      category: "design",
      severity: "high",
      title: "Missing H1 heading",
      description: "The page does not expose a clear main heading, which weakens structure for users and search engines.",
      deduction: 18,
      suggestion: "Add one clear H1 near the top of the page that states the core value proposition.",
      businessImpactMin: 80,
      businessImpactMax: 250
    });
  }

  if (signals.headings.levelCounts.h1 > 1) {
    pushIssue(issues, {
      id: "multiple_h1",
      category: "design",
      severity: "medium",
      title: "More than one H1 detected",
      description: `This page has ${signals.headings.levelCounts.h1} H1 headings, which can dilute the primary message and semantic hierarchy.`,
      deduction: 8,
      suggestion: "Keep one primary H1 and step supporting sections down to H2 or H3.",
      businessImpactMin: 40,
      businessImpactMax: 140
    });
  }

  if (!signals.hero.hasHero) {
    pushIssue(issues, {
      id: "missing_hero",
      category: "design",
      severity: "medium",
      title: "No obvious hero section",
      description: "The opening screen does not show a strong intro block with a headline, support copy, and a meaningful action.",
      deduction: 10,
      suggestion: "Create an above-the-fold hero that combines a sharp headline, brief supporting copy, and one primary CTA.",
      businessImpactMin: 120,
      businessImpactMax: 340
    });
  }

  if (signals.headings.weakStructure) {
    pushIssue(issues, {
      id: "weak_heading_structure",
      category: "design",
      severity: "medium",
      title: "Weak heading structure",
      description: "Heading levels appear inconsistent or skip expected steps, which makes the page harder to scan.",
      deduction: 10,
      suggestion: "Use a consistent H1-H2-H3 structure so each section has a clear role.",
      businessImpactMin: 50,
      businessImpactMax: 170
    });
  }

  if (signals.typography.fontFamilyCount > 4) {
    pushIssue(issues, {
      id: "too_many_fonts",
      category: "design",
      severity: "low",
      title: "Too many font families in use",
      description: `At least ${signals.typography.fontFamilyCount} font families were detected among visible text, which can make the design feel less cohesive.`,
      deduction: 6,
      suggestion: "Reduce typography to one display family and one body family where possible.",
      businessImpactMin: 35,
      businessImpactMax: 110
    });
  }

  if (
    signals.typography.contrastSampleCount >= 10 &&
    signals.typography.contrastRiskCount / signals.typography.contrastSampleCount >= 0.18
  ) {
    pushIssue(issues, {
      id: "contrast_risk",
      category: "design",
      severity: "high",
      title: "Visible text contrast risk",
      description: `A noticeable share of sampled text elements may fall below comfortable contrast levels, which hurts readability and trust.`,
      deduction: 12,
      suggestion: "Increase text-to-background contrast for body copy, supporting text, and subtle labels.",
      businessImpactMin: 90,
      businessImpactMax: 260
    });
  }

  if (!signals.typography.hasVisualHierarchy) {
    pushIssue(issues, {
      id: "weak_visual_hierarchy",
      category: "design",
      severity: "medium",
      title: "Weak visual hierarchy",
      description: "Heading sizes are not clearly separated from body text, so important content may not stand out.",
      deduction: 10,
      suggestion: "Increase size, weight, and spacing differences between headings, body copy, and supporting text.",
      businessImpactMin: 60,
      businessImpactMax: 180
    });
  }

  if (
    signals.typography.averageBodyFontSize > 0 &&
    signals.typography.averageBodyFontSize < 15
  ) {
    pushIssue(issues, {
      id: "small_body_text",
      category: "design",
      severity: "medium",
      title: "Body text appears very small",
      description: `Visible body text averages around ${signals.typography.averageBodyFontSize}px, which can add friction on smaller screens.`,
      deduction: 10,
      suggestion: "Aim for body text around 16px or above for better readability.",
      businessImpactMin: 70,
      businessImpactMax: 190
    });
  }

  if (signals.cta.interactiveAboveFoldCount > 12) {
    pushIssue(issues, {
      id: "too_many_competing_actions",
      category: "design",
      severity: "medium",
      title: "Too many competing actions above the fold",
      description: `There are ${signals.cta.interactiveAboveFoldCount} links or buttons visible in the first viewport, which can dilute the main conversion path.`,
      deduction: 8,
      suggestion: "Reduce above-the-fold noise and emphasize one primary CTA with one secondary action at most.",
      businessImpactMin: 110,
      businessImpactMax: 280
    });
  }

  if (!signals.cta.hasPrimaryCtaAboveFold) {
    pushIssue(issues, {
      id: "missing_primary_cta_top",
      category: "design",
      severity: "high",
      title: "No clear primary CTA near the top",
      description: "Visitors do not see an obvious next step immediately after landing on the page.",
      deduction: 12,
      suggestion: "Place a strong CTA high on the page using action language like book, request, contact, or get started.",
      businessImpactMin: 220,
      businessImpactMax: 700
    });
  }

  if (!signals.contact.hasPhone) {
    pushIssue(issues, {
      id: "missing_phone",
      category: "conversion",
      severity: "medium",
      title: "No phone number detected",
      description: "A direct phone contact path was not found, which can lower trust for lead-gen businesses.",
      deduction: 8,
      suggestion: "Add a visible phone number in the header, hero, or contact section.",
      businessImpactMin: 120,
      businessImpactMax: 360
    });
  }

  if (!signals.contact.hasEmail) {
    pushIssue(issues, {
      id: "missing_email",
      category: "conversion",
      severity: "low",
      title: "No email address detected",
      description: "An email contact option was not found in visible content or mailto links.",
      deduction: 6,
      suggestion: "Expose an email address or a contact method that feels direct and credible.",
      businessImpactMin: 60,
      businessImpactMax: 180
    });
  }

  if (!signals.contact.hasContactForm) {
    pushIssue(issues, {
      id: "missing_contact_form",
      category: "conversion",
      severity: "medium",
      title: "No obvious contact form",
      description: "The page does not show a clear built-in lead capture form for enquiries or quote requests.",
      deduction: 10,
      suggestion: "Add a short contact form to reduce friction for visitors who are ready to enquire.",
      businessImpactMin: 150,
      businessImpactMax: 420
    });
  }

  if (!signals.trust.hasTestimonials) {
    pushIssue(issues, {
      id: "missing_testimonials",
      category: "conversion",
      severity: "high",
      title: "No testimonials or reviews detected",
      description: "There is little visible customer validation on the page, which can reduce trust before a visitor reaches out.",
      deduction: 12,
      suggestion: "Add reviews, testimonial cards, or short proof quotes near decision points.",
      businessImpactMin: 180,
      businessImpactMax: 520
    });
  }

  if (!signals.trust.hasTrustSignals) {
    pushIssue(issues, {
      id: "missing_trust_signals",
      category: "conversion",
      severity: "high",
      title: "Weak trust signal coverage",
      description: "Certifications, guarantees, awards, partner logos, or similar trust cues were not clearly detected.",
      deduction: 12,
      suggestion: "Surface certifications, guarantees, awards, partner logos, or years of experience where users make decisions.",
      businessImpactMin: 180,
      businessImpactMax: 480
    });
  }

  if (signals.contact.looksCommercial && !signals.trust.hasPricing) {
    pushIssue(issues, {
      id: "missing_pricing",
      category: "conversion",
      severity: "low",
      title: "No obvious pricing or package clarity",
      description: "Commercial intent is visible, but public pricing, package guidance, or starting price cues were not found.",
      deduction: 6,
      suggestion: "Add pricing, package tiers, or at least a starting-from range to qualify leads faster.",
      businessImpactMin: 90,
      businessImpactMax: 260
    });
  }

  if (!signals.trust.hasFaq) {
    pushIssue(issues, {
      id: "missing_faq",
      category: "conversion",
      severity: "low",
      title: "No FAQ section detected",
      description: "A frequently asked questions section was not identified, which can leave common objections unanswered.",
      deduction: 5,
      suggestion: "Add a short FAQ section to answer common objections and reduce hesitation.",
      businessImpactMin: 45,
      businessImpactMax: 140
    });
  }

  if (!signals.trust.hasSocialProof) {
    pushIssue(issues, {
      id: "missing_social_proof",
      category: "conversion",
      severity: "medium",
      title: "Little visible social proof",
      description: "Evidence like ratings, customer counts, case studies, or notable clients was not strongly detected.",
      deduction: 8,
      suggestion: "Show proof such as ratings, client logos, milestone counts, or case studies.",
      businessImpactMin: 130,
      businessImpactMax: 360
    });
  }

  if (signals.contact.likelyLocalBusiness && !signals.contact.hasAddress) {
    pushIssue(issues, {
      id: "missing_location",
      category: "conversion",
      severity: "medium",
      title: "No clear address or location details",
      description: "This looks like a local business, but no strong location signal or address was detected.",
      deduction: 9,
      suggestion: "Add an address, service area, or location proof to increase confidence for local prospects.",
      businessImpactMin: 110,
      businessImpactMax: 300
    });
  }

  if (!signals.cta.hasPrimaryCtaAboveFold) {
    pushIssue(issues, {
      id: "missing_cta_above_fold",
      category: "conversion",
      severity: "high",
      title: "No CTA above the fold",
      description: "Users do not see a clear action path in the first viewport, which can reduce early conversion intent.",
      deduction: 14,
      suggestion: "Place one conversion-focused CTA above the fold with clear action-oriented wording.",
      businessImpactMin: 260,
      businessImpactMax: 760
    });
  }

  if (!pageInfo.title) {
    pushIssue(issues, {
      id: "missing_title",
      category: "technical",
      severity: "high",
      title: "Missing title tag",
      description: "The page title is missing, which hurts both search appearance and browser clarity.",
      deduction: 20,
      suggestion: "Add a descriptive title tag that clearly states the page topic and brand.",
      businessImpactMin: 70,
      businessImpactMax: 220
    });
  } else if (pageInfo.title.length < 20) {
    pushIssue(issues, {
      id: "weak_title",
      category: "technical",
      severity: "medium",
      title: "Title tag is very weak",
      description: `The title is only ${pageInfo.title.length} characters long, which may not communicate enough value or context.`,
      deduction: 10,
      suggestion: "Expand the title tag so it explains the page purpose more clearly.",
      businessImpactMin: 40,
      businessImpactMax: 140
    });
  }

  if (!pageInfo.metaDescription) {
    pushIssue(issues, {
      id: "missing_meta_description",
      category: "technical",
      severity: "medium",
      title: "Missing meta description",
      description: "Search engines may have to guess the preview snippet, which weakens click-through control.",
      deduction: 10,
      suggestion: "Add a concise meta description that explains the offer and the next step.",
      businessImpactMin: 50,
      businessImpactMax: 150
    });
  }

  if (!pageInfo.viewportMeta) {
    pushIssue(issues, {
      id: "missing_viewport_meta",
      category: "technical",
      severity: "high",
      title: "Missing viewport meta tag",
      description: "The page does not advertise responsive scaling, which is a strong mobile and technical risk.",
      deduction: 12,
      suggestion: "Add a viewport meta tag such as width=device-width, initial-scale=1.",
      businessImpactMin: 120,
      businessImpactMax: 360
    });
  }

  if (signals.images.missingAltCount > 0) {
    pushIssue(issues, {
      id: "images_missing_alt",
      category: "technical",
      severity: signals.images.missingAltCount >= 6 ? "high" : "medium",
      title: "Images without alt text",
      description: `${signals.images.missingAltCount} meaningful images appear to be missing alt text, which hurts accessibility and SEO coverage.`,
      deduction: signals.images.missingAltCount >= 6 ? 12 : 8,
      suggestion: "Add concise alt text to informative images while keeping decorative imagery intentionally empty.",
      businessImpactMin: 60,
      businessImpactMax: 180
    });
  }

  if (signals.images.imageCount > 60) {
    pushIssue(issues, {
      id: "very_large_image_count",
      category: "technical",
      severity: "low",
      title: "Very high image count",
      description: `This page loads ${signals.images.imageCount} images, which can add weight and make performance less predictable.`,
      deduction: 6,
      suggestion: "Audit image count, lazy-load non-critical assets, and compress oversized media.",
      businessImpactMin: 50,
      businessImpactMax: 150
    });
  }

  if (brokenLinks > 0) {
    pushIssue(issues, {
      id: "broken_internal_links",
      category: "technical",
      severity: "high",
      title: "Broken internal links found",
      description: `${brokenLinks} of the checked same-origin internal links returned an error response.`,
      deduction: clamp(10 + brokenLinks * 2, 10, 16),
      suggestion: "Repair or redirect broken internal URLs so users do not hit dead ends.",
      businessImpactMin: 90,
      businessImpactMax: 280
    });
  }

  const performanceSeverity = getPerformanceSeverity(signals.technical);
  if (performanceSeverity) {
    pushIssue(issues, {
      id: "performance_risk",
      category: "technical",
      severity: performanceSeverity,
      title: "Performance heuristics look weak",
      description: getPerformanceDescription(signals.technical),
      deduction: performanceSeverity === "high" ? 14 : 9,
      suggestion: "Reduce page weight, trim scripts, optimize imagery, and simplify oversized DOM structures.",
      businessImpactMin: performanceSeverity === "high" ? 180 : 110,
      businessImpactMax: performanceSeverity === "high" ? 520 : 320
    });
  }

  if (!pageInfo.lang) {
    pushIssue(issues, {
      id: "missing_lang",
      category: "technical",
      severity: "low",
      title: "Missing lang attribute",
      description: "The html element does not declare a language, which weakens semantics for browsers and assistive tools.",
      deduction: 6,
      suggestion: "Set the html lang attribute to the primary language of the page.",
      businessImpactMin: 25,
      businessImpactMax: 80
    });
  }

  if (!pageInfo.canonical) {
    pushIssue(issues, {
      id: "missing_canonical",
      category: "technical",
      severity: "low",
      title: "Missing canonical tag",
      description: "A canonical URL was not found, so duplicate or parameterized versions may be less clearly consolidated.",
      deduction: 6,
      suggestion: "Add a canonical tag so the preferred URL is explicit.",
      businessImpactMin: 25,
      businessImpactMax: 90
    });
  }

  if (pageInfo.openGraphTagCount === 0) {
    pushIssue(issues, {
      id: "missing_open_graph",
      category: "technical",
      severity: "low",
      title: "Missing Open Graph tags",
      description: "Social preview metadata was not detected, which weakens how the page appears when shared.",
      deduction: 4,
      suggestion: "Add basic Open Graph tags for title, description, image, and URL.",
      businessImpactMin: 30,
      businessImpactMax: 90
    });
  }

  if (signals.forms.unlabeledControlCount > 0) {
    pushIssue(issues, {
      id: "forms_without_labels",
      category: "technical",
      severity: "medium",
      title: "Form controls without labels",
      description: `${signals.forms.unlabeledControlCount} visible form controls appear to be missing associated labels or aria labels.`,
      deduction: 10,
      suggestion: "Add visible labels or accessible aria labels to every interactive form control.",
      businessImpactMin: 70,
      businessImpactMax: 210
    });
  }

  if (!pageInfo.viewportMeta) {
    pushIssue(issues, {
      id: "mobile_viewport_missing",
      category: "mobile",
      severity: "high",
      title: "Responsive viewport configuration missing",
      description: "Without a viewport meta tag, mobile rendering is more likely to feel zoomed out or awkward.",
      deduction: 18,
      suggestion: "Add a responsive viewport meta tag to improve default mobile scaling.",
      businessImpactMin: 150,
      businessImpactMax: 420
    });
  }

  if (signals.mobile.hasHorizontalOverflowRisk) {
    pushIssue(issues, {
      id: "horizontal_overflow",
      category: "mobile",
      severity: "high",
      title: "Horizontal overflow risk",
      description: `The document width exceeds the current viewport by ${signals.mobile.documentWidth - signals.mobile.viewportWidth}px, which suggests horizontal scrolling risk.`,
      deduction: 14,
      suggestion: "Fix overflowing sections, media, and containers so the layout stays inside the viewport.",
      businessImpactMin: 130,
      businessImpactMax: 360
    });
  }

  if (signals.mobile.smallTouchTargetCount >= 3) {
    pushIssue(issues, {
      id: "touch_targets_small",
      category: "mobile",
      severity: "medium",
      title: "Touch targets may be too small",
      description: `${signals.mobile.smallTouchTargetCount} visible interactive elements are below the recommended 44px touch size.`,
      deduction: 10,
      suggestion: "Increase button and link tap areas so mobile interactions feel easier and less error-prone.",
      businessImpactMin: 90,
      businessImpactMax: 250
    });
  }

  if (signals.mobile.smallMobileTextRisk) {
    pushIssue(issues, {
      id: "mobile_text_small",
      category: "mobile",
      severity: "medium",
      title: "Text may be small for mobile readers",
      description: "The current typography scale suggests body text may feel cramped on smaller devices.",
      deduction: 10,
      suggestion: "Increase text size and line-height so mobile visitors can scan content more comfortably.",
      businessImpactMin: 80,
      businessImpactMax: 220
    });
  }

  if (signals.mobile.elementsExceedingViewportCount > 0) {
    pushIssue(issues, {
      id: "elements_wider_than_viewport",
      category: "mobile",
      severity: "medium",
      title: "Some layout elements exceed the viewport",
      description: `${signals.mobile.elementsExceedingViewportCount} visible elements appear wider than the current viewport.`,
      deduction: 10,
      suggestion: "Audit wide sections, media, and wrappers for max-width and overflow issues.",
      businessImpactMin: 90,
      businessImpactMax: 250
    });
  }

  if (signals.mobile.buttonsTooCloseCount >= 2) {
    pushIssue(issues, {
      id: "buttons_too_close",
      category: "mobile",
      severity: "medium",
      title: "Buttons appear tightly packed",
      description: "Multiple interactive controls sit very close together, which can lead to mis-taps on mobile screens.",
      deduction: 8,
      suggestion: "Add more spacing between key buttons and links, especially in the first viewport.",
      businessImpactMin: 70,
      businessImpactMax: 180
    });
  }

  if (signals.mobile.fixedWidthContainerCount > 0) {
    pushIssue(issues, {
      id: "fixed_width_containers",
      category: "mobile",
      severity: "medium",
      title: "Fixed-width container risk",
      description: `${signals.mobile.fixedWidthContainerCount} visible containers appear wider than the viewport or rely on rigid minimum widths.`,
      deduction: 10,
      suggestion: "Replace rigid widths with fluid sizing, max-width rules, and responsive wrappers.",
      businessImpactMin: 90,
      businessImpactMax: 240
    });
  }

  const scores = calculateScores(issues);
  const suggestions = buildSuggestions(issues);
  const businessOpportunity = buildBusinessOpportunity(issues, scores, signals);

  return {
    generatedAt: new Date().toISOString(),
    pageInfo,
    rawSignals: {
      ...signals,
      linkValidation
    },
    issues,
    scores,
    suggestions,
    businessOpportunity,
    notes: {
      brokenLinkCheck:
        brokenLinks > 0 || uncheckedLinks > 0 || linkValidation.checkedCount > 0
          ? `Checked ${linkValidation.checkedCount} same-origin internal links. ${brokenLinks} broken, ${uncheckedLinks} unchecked.`
          : "No same-origin internal links were available for validation on this page.",
      consoleErrors:
        "Console error counts are not captured in version 1 because the extension does not hook into page logs retroactively."
    }
  };
}

function getPerformanceSeverity(technical) {
  const highRisk =
    (technical.loadMs && technical.loadMs > 4500) ||
    (technical.domContentLoadedMs && technical.domContentLoadedMs > 2500) ||
    technical.domNodeCount > 2200 ||
    technical.scriptCount > 30;

  if (highRisk) {
    return "high";
  }

  const mediumRisk =
    (technical.loadMs && technical.loadMs > 2800) ||
    (technical.domContentLoadedMs && technical.domContentLoadedMs > 1600) ||
    technical.domNodeCount > 1400 ||
    technical.scriptCount > 18 ||
    technical.stylesheetCount > 10;

  return mediumRisk ? "medium" : null;
}

function getPerformanceDescription(technical) {
  const parts = [];

  if (technical.domContentLoadedMs) {
    parts.push(`DOMContentLoaded is about ${technical.domContentLoadedMs}ms`);
  }

  if (technical.loadMs) {
    parts.push(`load time is about ${technical.loadMs}ms`);
  }

  parts.push(`${technical.scriptCount} scripts`);
  parts.push(`${technical.stylesheetCount} stylesheets`);
  parts.push(`${technical.domNodeCount} DOM nodes`);

  return `Performance is estimated from browser timing and page weight heuristics rather than Lighthouse. Signals include ${parts.join(", ")}.`;
}

function calculateScores(issues) {
  const deductions = {
    design: 0,
    conversion: 0,
    technical: 0,
    mobile: 0
  };

  for (const issue of issues) {
    deductions[issue.category] += issue.deduction;
  }

  const design = clamp(100 - deductions.design, 0, 100);
  const conversion = clamp(100 - deductions.conversion, 0, 100);
  const technical = clamp(100 - deductions.technical, 0, 100);
  const mobile = clamp(100 - deductions.mobile, 0, 100);

  const overall = Math.round(
    design * SCORE_WEIGHTS.design +
      conversion * SCORE_WEIGHTS.conversion +
      technical * SCORE_WEIGHTS.technical +
      mobile * SCORE_WEIGHTS.mobile
  );

  return {
    design,
    conversion,
    technical,
    mobile,
    overall,
    status: getScoreStatus(overall)
  };
}

function buildSuggestions(issues) {
  const seen = new Set();

  return issues
    .slice()
    .sort((left, right) => {
      const rightSeverity = SEVERITY_ORDER[right.severity] || 0;
      const leftSeverity = SEVERITY_ORDER[left.severity] || 0;
      if (rightSeverity !== leftSeverity) {
        return rightSeverity - leftSeverity;
      }
      return right.businessImpactMax - left.businessImpactMax;
    })
    .filter((issue) => {
      if (seen.has(issue.suggestion)) {
        return false;
      }
      seen.add(issue.suggestion);
      return true;
    })
    .slice(0, 6)
    .map((issue) => ({
      title: issue.title,
      description: issue.suggestion,
      priority: issue.severity
    }));
}

function buildBusinessOpportunity(issues, scores, signals) {
  let estimatedMonthlyLossMin = 120;
  let estimatedMonthlyLossMax = 420;

  // This estimate is intentionally conservative and directional. It is meant for
  // sales prospecting, not for claiming real analytics-backed revenue loss.
  for (const issue of issues) {
    if (
      issue.id === "missing_cta_above_fold" ||
      issue.id === "missing_primary_cta_top" ||
      issue.id === "missing_testimonials" ||
      issue.id === "missing_trust_signals" ||
      issue.id === "missing_contact_form" ||
      issue.id === "missing_phone" ||
      issue.id === "missing_pricing" ||
      issue.id === "horizontal_overflow" ||
      issue.id === "performance_risk"
    ) {
      estimatedMonthlyLossMin += issue.businessImpactMin;
      estimatedMonthlyLossMax += issue.businessImpactMax;
    }
  }

  if (scores.conversion < 55) {
    estimatedMonthlyLossMin += 160;
    estimatedMonthlyLossMax += 500;
  }

  if (scores.mobile < 60) {
    estimatedMonthlyLossMin += 100;
    estimatedMonthlyLossMax += 320;
  }

  if (scores.technical < 60) {
    estimatedMonthlyLossMin += 70;
    estimatedMonthlyLossMax += 220;
  }

  if (signals.contact.looksCommercial) {
    estimatedMonthlyLossMin *= 1.15;
    estimatedMonthlyLossMax *= 1.2;
  }

  if (signals.contact.likelyLocalBusiness) {
    estimatedMonthlyLossMin *= 1.1;
    estimatedMonthlyLossMax *= 1.1;
  }

  estimatedMonthlyLossMin = roundToNearest(Math.round(estimatedMonthlyLossMin), 50);
  estimatedMonthlyLossMax = roundToNearest(Math.round(estimatedMonthlyLossMax), 50);

  if (estimatedMonthlyLossMax < estimatedMonthlyLossMin + 150) {
    estimatedMonthlyLossMax = estimatedMonthlyLossMin + 150;
  }

  const topFixes = issues
    .slice()
    .sort((left, right) => {
      if (right.businessImpactMax !== left.businessImpactMax) {
        return right.businessImpactMax - left.businessImpactMax;
      }
      return (SEVERITY_ORDER[right.severity] || 0) - (SEVERITY_ORDER[left.severity] || 0);
    })
    .slice(0, 3)
    .map((issue) => issue.suggestion);

  const highestImpactIssues = issues
    .slice()
    .sort((left, right) => right.businessImpactMax - left.businessImpactMax)
    .slice(0, 3);

  const reasonLabels = highestImpactIssues.map((issue) =>
    issue.title.charAt(0).toLowerCase() + issue.title.slice(1)
  );

  const explanation = `This website may be losing approximately ${formatCurrencyRange(
    estimatedMonthlyLossMin,
    estimatedMonthlyLossMax
  )} per month in potential conversions due to ${joinLabels(reasonLabels)}. This is a prospecting estimate based on page heuristics, not analytics or confirmed sales data.`;

  const whyThisMatters =
    "When visitors do not immediately trust the site, understand the offer, or find a simple next step, more of them bounce before enquiring, booking, or buying.";

  const outreachMessage = buildOutreachMessage(highestImpactIssues);

  return {
    estimatedMonthlyLossMin,
    estimatedMonthlyLossMax,
    explanation,
    whyThisMatters,
    topFixes,
    outreachMessage
  };
}

function joinLabels(labels) {
  if (labels.length === 0) {
    return "general conversion friction";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function buildOutreachMessage(topIssues) {
  const phrases = topIssues
    .map((issue) => issue.title.toLowerCase())
    .slice(0, 3);

  return `Hey, I checked your website and noticed a few conversion issues, including ${joinLabels(
    phrases
  )}. These kinds of problems can reduce trust and lead flow, especially on mobile. I help businesses improve sites like this quickly and would be happy to show you the first fixes I would prioritize.`;
}

function roundToNearest(value, nearest) {
  return Math.max(nearest, Math.round(value / nearest) * nearest);
}

function groupIssuesByCategory(issues) {
  return Object.keys(CATEGORY_LABELS).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: issues.filter((issue) => issue.category === category)
  }));
}

function renderReport(report) {
  const { scores, issues, suggestions, businessOpportunity, notes, rawSignals } = report;
  const groupedIssues = groupIssuesByCategory(issues);
  const scoreColor = getScoreColor(scores.overall);
  const scoreAngle = `${Math.round((scores.overall / 100) * 360)}deg`;

  app.innerHTML = `
    <div class="stack">
      <section class="card score-card">
        <div class="score-ring" style="--score-color: ${scoreColor}; --score-angle: ${scoreAngle};">
          <div class="score-ring-content">
            <div class="score-value">${scores.overall}</div>
            <div class="score-status">${escapeHtml(scores.status)}</div>
          </div>
        </div>
        <div class="score-meta">
          <div class="pill-row">
            <span class="status-pill ${scores.status.toLowerCase()}">${escapeHtml(scores.status)}</span>
            <span class="utility-pill">Weighted score</span>
          </div>
          <p class="score-description">
            The score blends design, trust, technical, and mobile heuristics to highlight sites that may be good redesign or optimization prospects.
          </p>
          <div class="inline-note">
            <p class="helper-text">${escapeHtml(notes.brokenLinkCheck)}</p>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Category Breakdown</h2>
        <div class="category-grid">
          ${renderCategoryProgress("Design / Structure", scores.design)}
          ${renderCategoryProgress("Conversion / Trust", scores.conversion)}
          ${renderCategoryProgress("Technical / SEO", scores.technical)}
          ${renderCategoryProgress("Mobile Optimization", scores.mobile)}
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Key Page Signals</h2>
        <div class="metric-grid">
          ${renderMetricChip("Title", report.pageInfo.title ? "Present" : "Missing")}
          ${renderMetricChip("Meta description", report.pageInfo.metaDescription ? "Present" : "Missing")}
          ${renderMetricChip("Viewport", report.pageInfo.viewportMeta ? "Present" : "Missing")}
          ${renderMetricChip("Phone", rawSignals.contact.hasPhone ? "Detected" : "Missing")}
          ${renderMetricChip("Email", rawSignals.contact.hasEmail ? "Detected" : "Missing")}
          ${renderMetricChip("Contact form", rawSignals.contact.hasContactForm ? "Detected" : "Missing")}
          ${renderMetricChip("Testimonials", rawSignals.trust.hasTestimonials ? "Detected" : "Not found")}
          ${renderMetricChip("Trust signals", rawSignals.trust.hasTrustSignals ? "Detected" : "Not found")}
          ${renderMetricChip("Images missing alt", String(rawSignals.images.missingAltCount))}
          ${renderMetricChip("Internal links checked", String(rawSignals.linkValidation.checkedCount))}
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Issues</h2>
        <div class="issues-group">
          ${groupedIssues
            .filter((group) => group.items.length > 0)
            .map(renderIssueGroup)
            .join("") || `<p class="muted-copy">No major issues were flagged by the current heuristic set.</p>`}
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Suggestions</h2>
        <div class="suggestion-list">
          ${suggestions.map(renderSuggestion).join("")}
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Business Opportunity</h2>
        <div class="business-estimate">
          <div class="estimate-value">${escapeHtml(
            formatCurrencyRange(
              businessOpportunity.estimatedMonthlyLossMin,
              businessOpportunity.estimatedMonthlyLossMax
            )
          )}</div>
          <div class="estimate-label">estimated monthly conversion loss</div>
        </div>
        <p class="business-copy">${escapeHtml(businessOpportunity.explanation)}</p>
        <div class="inline-note">
          <p class="helper-text">${escapeHtml(businessOpportunity.whyThisMatters)}</p>
        </div>

        <div style="margin-top: 14px;">
          <h3 class="group-title">Top 3 highest-impact fixes</h3>
          <div class="fix-list" style="margin-top: 10px;">
            ${businessOpportunity.topFixes.map(renderFix).join("")}
          </div>
        </div>

        <div class="outreach-box">
          <p id="outreach-message">${escapeHtml(businessOpportunity.outreachMessage)}</p>
        </div>

        <div class="button-row">
          <button id="copy-message" class="button-primary">Copy message</button>
          <button id="copy-report" class="button-secondary">Copy full report</button>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">Utilities</h2>
        <p class="muted-copy">Everything stays local in the browser. If a signal cannot be verified reliably, it is treated as heuristic or left unchecked.</p>
        <div class="button-row">
          <button id="analyze-again" class="button-secondary">Analyze again</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById("copy-message")?.addEventListener("click", async () => {
    await copyToClipboard(businessOpportunity.outreachMessage, "Message copied");
  });

  document.getElementById("copy-report")?.addEventListener("click", async () => {
    await copyToClipboard(buildReportText(report), "Full report copied");
  });

  document.getElementById("analyze-again")?.addEventListener("click", () => {
    analyzeActiveTab(true);
  });
}

function renderCategoryProgress(label, score) {
  return `
    <div class="category-item">
      <div class="category-head">
        <span>${escapeHtml(label)}</span>
        <strong>${score}/100</strong>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${score}%"></div>
      </div>
    </div>
  `;
}

function renderIssueGroup(group) {
  return `
    <div>
      <div class="group-header">
        <h3 class="group-title">${escapeHtml(group.label)}</h3>
        <span class="group-count">${group.items.length} issue${group.items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="issue-list">
        ${group.items.map(renderIssue).join("")}
      </div>
    </div>
  `;
}

function renderIssue(issue) {
  return `
    <article class="issue-item">
      <div class="issue-item-head">
        <h4 class="issue-title">${escapeHtml(issue.title)}</h4>
        <span class="severity-badge ${issue.severity}">${escapeHtml(issue.severity)}</span>
      </div>
      <p class="issue-description">${escapeHtml(issue.description)}</p>
    </article>
  `;
}

function renderSuggestion(suggestion) {
  return `
    <article class="suggestion-item">
      <div class="suggestion-item-head">
        <h4 class="suggestion-title">${escapeHtml(suggestion.title)}</h4>
        <span class="severity-badge ${suggestion.priority}">${escapeHtml(suggestion.priority)}</span>
      </div>
      <p class="suggestion-description">${escapeHtml(suggestion.description)}</p>
    </article>
  `;
}

function renderFix(text) {
  return `<div class="fix-item"><p class="issue-description">${escapeHtml(text)}</p></div>`;
}

function renderMetricChip(label, value) {
  return `
    <div class="metric-chip">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function buildReportText(report) {
  const groupedIssues = groupIssuesByCategory(report.issues);
  const issueLines = groupedIssues
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const lines = group.items
        .map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.title}: ${issue.description}`)
        .join("\n");
      return `${group.label}\n${lines}`;
    })
    .join("\n\n");

  return [
    "Broken Website Detector Report",
    `URL: ${report.pageInfo.url}`,
    `Generated: ${report.generatedAt}`,
    "",
    `Overall score: ${report.scores.overall}/100 (${report.scores.status})`,
    `Design / Structure: ${report.scores.design}/100`,
    `Conversion / Trust: ${report.scores.conversion}/100`,
    `Technical / SEO: ${report.scores.technical}/100`,
    `Mobile Optimization: ${report.scores.mobile}/100`,
    "",
    "Issues",
    issueLines || "No major issues flagged.",
    "",
    "Top suggestions",
    ...report.suggestions.map((item) => `- ${item.description}`),
    "",
    "Business Opportunity",
    report.businessOpportunity.explanation,
    `Top fixes: ${report.businessOpportunity.topFixes.join(" | ")}`,
    "",
    "Outreach message",
    report.businessOpportunity.outreachMessage,
    "",
    "Notes",
    `- ${report.notes.brokenLinkCheck}`,
    `- ${report.notes.consoleErrors}`
  ].join("\n");
}

async function copyToClipboard(text, successLabel) {
  try {
    await navigator.clipboard.writeText(text);
    flashUtilityLabel(successLabel);
  } catch (error) {
    flashUtilityLabel("Copy failed");
  }
}

function flashUtilityLabel(message) {
  const utilityCard = document.querySelector(".card:last-child .muted-copy");
  if (!utilityCard) {
    return;
  }

  const original = utilityCard.textContent;
  utilityCard.textContent = message;
  setTimeout(() => {
    utilityCard.textContent = original;
  }, 1400);
}
