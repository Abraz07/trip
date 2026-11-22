// Opens WhatsApp with a ready message; the user picks the group and taps Send.
export const tripLink = (tripId) => `${location.origin}/#/t/${tripId}`
export const waUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

export function WhatsAppButton({ text, label = 'Share on WhatsApp', className = '' }) {
  return (
    <a
      href={waUrl(text)}
      aria-label={label || "Share on WhatsApp"}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] text-white font-semibold px-3 py-2 text-sm active:scale-[.98] ${className}`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4 fill-current"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>
      {label}
    </a>
  )
}
