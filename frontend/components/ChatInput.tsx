import { useState, useRef, KeyboardEvent } from 'react'
import { useLocale } from '../lib/LocaleContext'

interface Props {
  onSubmit: (message: string) => void
  disabled?: boolean
}

export default function ChatInput({ onSubmit, disabled }: Props) {
  const { t } = useLocale()
  const [value, setValue] = useState('')
  const [showHints, setShowHints] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const demoHints = [t('example1'), t('example2'), t('example3')]

  const handleSubmit = () => {
    const msg = value.trim()
    if (!msg || disabled) return
    onSubmit(msg)
    setValue('')
    setShowHints(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const useHint = (hint: string) => {
    setValue(hint)
    setShowHints(false)
    textareaRef.current?.focus()
  }

  return (
    <div className="relative">
      {/* 示例提示 */}
      {showHints && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-hsk-surface border border-hsk-border rounded-xl overflow-hidden shadow-xl z-10">
          <div className="px-3 py-2 text-xs text-hsk-muted border-b border-hsk-border">
            {t('examplesLabel')}
          </div>
          {demoHints.map((hint, i) => (
            <button
              key={i}
              onClick={() => useHint(hint)}
              className="w-full text-left px-4 py-3 text-sm text-hsk-text hover:bg-hsk-border/30 transition-colors border-b border-hsk-border/50 last:border-0"
            >
              <span className="text-hsk-muted mr-2">{i + 1}.</span>
              {hint}
            </button>
          ))}
        </div>
      )}

      <div
        className={`flex items-end gap-2 bg-hsk-surface border rounded-xl px-4 py-3 transition-colors ${
          disabled
            ? 'border-hsk-border opacity-60'
            : 'border-hsk-border hover:border-hsk-blue/50 focus-within:border-hsk-blue'
        }`}
      >
        {/* 示例按钮 */}
        <button
          onClick={() => setShowHints(s => !s)}
          disabled={disabled}
          className="text-hsk-muted hover:text-hsk-text text-lg pb-0.5 transition-colors flex-shrink-0"
          title={t('examplesLabel')}
        >
          💡
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={t('inputPlaceholder')}
          className="flex-1 bg-transparent resize-none outline-none text-sm text-hsk-text placeholder-hsk-muted min-h-[24px] max-h-[120px] leading-6"
          style={{ overflowY: value.split('\n').length > 4 ? 'auto' : 'hidden' }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 120) + 'px'
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            value.trim() && !disabled
              ? 'bg-hsk-blue hover:bg-blue-500 text-white'
              : 'bg-hsk-border text-hsk-muted cursor-not-allowed'
          }`}
        >
          {disabled ? (
            <span className="inline-block w-4 h-4 border-2 border-hsk-muted/30 border-t-hsk-muted rounded-full animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 8l6-6 6 6M8 2v12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 8 8)" />
            </svg>
          )}
        </button>
      </div>

      <div className="text-xs text-hsk-muted mt-1.5 px-1">
        {t('inputHint')}
      </div>
    </div>
  )
}
