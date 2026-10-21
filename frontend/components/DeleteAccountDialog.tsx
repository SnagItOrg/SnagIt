'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'

/* ==========================================================================
   DeleteAccountDialog — PAN-277, the confirmation before "Slet konto".

   Astryx AlertDialog (facebook/astryx 684ca57,
   packages/core/src/AlertDialog/AlertDialog.spec.md and AlertDialog.tsx):
     - role="alertdialog", named by the title and described by the
       consequence (AR1); a backdrop click does not dismiss it (FR1) — both in
       `Dialog`'s `role` prop;
     - anatomy title, description, then Cancel and the action (FR3); on a
       screen up to 640px (AlertDialog.tsx:35) the action stacks above Cancel,
       in DOM order as well as visually, as AlertDialog.tsx:245 does;
     - initial focus on Cancel, the least destructive action (AR1);
     - the action button is the destructive fill (Button.tsx:229), here the
       `--destructive` tokens, and shows its pending state while it runs.

   Klup's addition: the action stays disabled until the visitor has typed the
   locale's confirmation word. Astryx has no typed-confirmation pattern; the
   ticket asks for one because this action cannot be undone.
   ========================================================================== */

const SMALL_SCREEN_QUERY = '(max-width: 640px)'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  pending: boolean
  failed: boolean
}

export function DeleteAccountDialog({ open, onClose, onConfirm, pending, failed }: Props) {
  const { t } = useLocale()
  const titleId = useId()
  const bodyId = useId()
  const inputId = useId()
  const [typed, setTyped] = useState('')
  const [small, setSmall] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(SMALL_SCREEN_QUERY)
    setSmall(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  const confirmed = typed.trim().toUpperCase() === t.deleteAccountWord

  const cancel = (
    <Button
      key="cancel"
      variant="secondary"
      onClick={onClose}
      autoFocus
      className="min-h-[44px] rounded-xl px-5 text-sm font-semibold"
    >
      {t.cancel}
    </Button>
  )
  const action = (
    <button
      key="action"
      type="button"
      onClick={onConfirm}
      disabled={!confirmed || pending}
      className="min-h-[44px] rounded-xl px-5 text-sm font-semibold bg-destructive hover:bg-destructive-hover text-destructive-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {pending ? t.loading : t.deleteAccountHeading}
    </button>
  )

  return (
    <Dialog
      open={open}
      onClose={pending ? () => {} : onClose}
      labelledBy={titleId}
      describedBy={bodyId}
      role="alertdialog"
      panelClassName="w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-6 flex flex-col gap-4"
    >
      <h2 id={titleId} className="text-lg font-bold text-foreground">{t.deleteAccountConfirmTitle}</h2>
      <p id={bodyId} className="text-sm text-muted-foreground">{t.deleteAccountConfirmBody}</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {fill(t.deleteAccountTypeLabel, { word: t.deleteAccountWord })}
        </label>
        <TextField
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={pending}
          className="w-full rounded-xl px-4 py-3 text-sm"
        />
      </div>

      {failed && (
        <p role="alert" className="text-xs rounded-lg px-3 py-2 bg-destructive-subtle" style={{ color: 'var(--destructive-text)' }}>
          {t.deleteAccountError}
        </p>
      )}

      <div className={small ? 'flex flex-col gap-2' : 'flex flex-row justify-end gap-2'}>
        {small ? [action, cancel] : [cancel, action]}
      </div>
    </Dialog>
  )
}
