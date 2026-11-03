const header = document.getElementById('siteHeader')
const toast = document.querySelector('.toast')

const onScroll = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 8)
}
onScroll()
window.addEventListener('scroll', onScroll, { passive: true })

let toastTimer
function showToast(message) {
  if (!toast) return
  toast.textContent = message
  toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2000)
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
    }, 2000)
  })
}

const year = document.getElementById('year')
if (year) year.textContent = String(new Date().getFullYear())
