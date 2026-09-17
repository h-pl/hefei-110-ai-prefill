import { useEffect } from 'react'

const staticTextSelector = '[role=listbox],[role=option],[data-slot=select-content],.evidence-panel,.header-call-info,.risk-banner,.transcript-column,.input-frame,label,.label-group,h1,h2,h3,h4,h5,h6,.brand,[data-motion-static]'
const effects = new WeakMap<HTMLElement, Animation>()

// Animate only the changed text, leaving surrounding controls and layout intact.
export function animateUpdatedText(el: HTMLElement) {
  if (el.closest(staticTextSelector) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  effects.get(el)?.cancel()
  const sweep = 'linear-gradient(100deg, #000 15%, #0004 40%, #000 65%)'
  const animation = el.animate([
    { maskImage: sweep, maskSize: '260% 100%', maskPosition: '140% 0' },
    { maskImage: sweep, maskSize: '260% 100%', maskPosition: '-100% 0' },
  ], { duration: 900, easing: 'ease-out' })
  effects.set(el, animation)
}

export function usePageTextMotion() {
  useEffect(() => {
    // Cancel any old global sweep still running after a hot update.
    document.querySelectorAll(staticTextSelector).forEach(root => {
      root.getAnimations({ subtree: true }).forEach(animation => {
        if (animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => frame.maskImage)) animation.cancel()
      })
    })
    const targets = new Set<HTMLElement>()
    const collect = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const el = node.parentElement
        if (!node.textContent?.trim() || !el || el.childElementCount) return
        // These already animate the exact new text, or should not be animated.
        if (el.closest(staticTextSelector) || el.closest('.followup-copy,.thinking-text,.transcript-chunk,.transcript-caret,.sr-only,input,textarea,select,script,style,[data-motion-static]')) return
        if (el.getAttribute('aria-hidden') === 'true') return
        targets.add(el)
      } else {
        for (const child of node.childNodes) collect(child)
      }
    }
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') collect(record.target)
        else for (const node of record.addedNodes) collect(node)
      }
      for (const target of targets) if (target.isConnected) animateUpdatedText(target)
      targets.clear()
    })
    observer.observe(document.body, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}
