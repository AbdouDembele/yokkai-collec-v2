export const animation = {
  duration: {
    instant: 100,
    fast: 200,
    normal: 350,
    slow: 600,
    reduced: 150,
    skeleton: 1500,
    toast: 2600,
    ambient: 5000
  },
  easing: {
    instant: "cubic-bezier(0.2, 0, 0, 1)",
    standard: "cubic-bezier(0.16, 1, 0.3, 1)",
    exit: "cubic-bezier(0.7, 0, 0.84, 0)"
  },
  stagger: {
    item: 30,
    maximum: 300
  },
  page: {
    enter: 250,
    enterDelay: 100,
    exit: 150,
    enterScale: 1.02
  },
  modal: { duration: 350 },
  feedback: { duration: 350 },
  market: { extensionNotice: 6000, extensionPulse: 600 },
  packOpening: {
    seal: 800,
    fade: 150,
    slowResponse: 1500
  },
  cardShell: {
    perspective: "900px",
    hoverLift: "-6px",
    tiltX: 3,
    tiltY: 4,
    reflectionTravel: 30,
    reflectionOpacity: 0.34,
    demoReflectionOffset: "-12%"
  }
} as const;

export const animationCssVariables = {
  "--duration-instant": `${animation.duration.instant}ms`,
  "--duration-fast": `${animation.duration.fast}ms`,
  "--duration-normal": `${animation.duration.normal}ms`,
  "--duration-slow": `${animation.duration.slow}ms`,
  "--duration-reduced": `${animation.duration.reduced}ms`,
  "--duration-skeleton": `${animation.duration.skeleton}ms`,
  "--duration-toast": `${animation.duration.toast}ms`,
  "--duration-ambient": `${animation.duration.ambient}ms`,
  "--stagger-item": `${animation.stagger.item}ms`,
  "--stagger-maximum": `${animation.stagger.maximum}ms`,
  "--page-enter-duration": `${animation.page.enter}ms`,
  "--page-enter-delay": `${animation.page.enterDelay}ms`,
  "--page-exit-duration": `${animation.page.exit}ms`,
  "--page-enter-scale": `${animation.page.enterScale}`,
  "--modal-duration": `${animation.modal.duration}ms`,
  "--feedback-duration": `${animation.feedback.duration}ms`,
  "--market-extension-pulse": `${animation.market.extensionPulse}ms`,
  "--pack-opening-fade-duration": `${animation.packOpening.fade}ms`,
  "--ease-instant": animation.easing.instant,
  "--ease-standard": animation.easing.standard,
  "--ease-exit": animation.easing.exit,
  "--card-shell-perspective": animation.cardShell.perspective,
  "--card-shell-hover-lift": animation.cardShell.hoverLift,
  "--card-shell-demo-tilt-x": `${-animation.cardShell.tiltX}deg`,
  "--card-shell-demo-tilt-y": `${animation.cardShell.tiltY}deg`,
  "--card-shell-reflection-opacity": `${animation.cardShell.reflectionOpacity}`,
  "--card-shell-demo-reflection-offset":
    animation.cardShell.demoReflectionOffset
} as const;
