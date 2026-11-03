const header = document.getElementById('siteHeader')
const toast = document.querySelector('.toast')

const onScroll = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 12)
}
onScroll()
window.addEventListener('scroll', onScroll, { passive: true })

const reveals = document.querySelectorAll('.reveal')
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

if (reduced || !('IntersectionObserver' in window)) {
  reveals.forEach((node) => node.classList.add('is-in'))
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  reveals.forEach((node) => observer.observe(node))
}

let toastTimer
function showToast(message) {
  if (!toast) return
  toast.textContent = message
  toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    input.remove()
    return copied
  }
}

for (const button of document.querySelectorAll('[data-copy]')) {
  const label = button.querySelector('span')
  const original = label?.textContent ?? 'Copy'
  button.addEventListener('click', async () => {
    const copied = await copyText(button.dataset.copy ?? '')
    if (!copied) {
      showToast('Could not copy — select the text manually')
      return
    }
    button.classList.add('is-copied')
    if (label) label.textContent = 'Copied'
    showToast('Copied to clipboard')
    window.setTimeout(() => {
      button.classList.remove('is-copied')
      if (label) label.textContent = original
    }, 1800)
  })
}

const year = document.getElementById('year')
if (year) year.textContent = String(new Date().getFullYear())
