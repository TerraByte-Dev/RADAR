import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import type { UpdateEvent } from '@shared/types'
import { Section, SettingRow } from '../primitives'

type Status =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev-mode'

const REPO = 'https://github.com/TerraByte-Dev/ToDoPlus'

function StatusLine({
  status,
  availableVer,
  progress,
  errorMsg
}: {
  status: Status
  availableVer: string
  progress: number
  errorMsg: string
}): JSX.Element | null {
  if (status === 'idle') return null
  const base = 'font-mono text-[11px]'
  if (status === 'checking') return <span className={`${base} text-term-cyan`}>scanning for updates…</span>
  if (status === 'up-to-date')
    return <span className={`${base} text-phosphor`}>you’re on the latest version</span>
  if (status === 'available')
    return <span className={`${base} text-term-cyan`}>v{availableVer} is available</span>
  if (status === 'downloading')
    return (
      <div className="w-full">
        <span className={`${base} text-term-cyan`}>downloading… {progress}%</span>
        <div className="mt-1.5 h-0.5 w-full bg-phosphor/15">
          <div className="h-full bg-phosphor transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    )
  if (status === 'downloaded')
    return <span className={`${base} text-phosphor`}>update ready — restart to apply</span>
  if (status === 'error') return <span className={`${base} text-p1`}>{errorMsg || 'update check failed'}</span>
  if (status === 'dev-mode')
    return <span className={`${base} text-faint`}>updates only available in packaged builds</span>
  return null
}

/** App identity, version, and the manual update check → download → install flow. */
export default function About(): JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [availableVer, setAvailableVer] = useState('')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
    return window.api.onUpdateEvent((e: UpdateEvent) => {
      if (e.type === 'available') {
        setAvailableVer(e.version)
        setStatus('available')
      } else if (e.type === 'not-available') {
        setStatus('up-to-date')
      } else if (e.type === 'progress') {
        setProgress(e.percent)
        setStatus('downloading')
      } else if (e.type === 'downloaded') {
        setStatus('downloaded')
      } else if (e.type === 'error') {
        setErrorMsg(e.message)
        setStatus('error')
      }
    })
  }, [])

  const check = async (): Promise<void> => {
    setStatus('checking')
    setErrorMsg('')
    const r = await window.api.checkForUpdates()
    if (r.devMode) setStatus('dev-mode')
  }
  const download = (): void => {
    setStatus('downloading')
    setProgress(0)
    window.api.downloadUpdate()
  }

  const btn =
    'inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors disabled:opacity-50 border-rule text-muted hover:border-phosphor hover:text-phosphor'

  let action: JSX.Element
  if (status === 'available') {
    action = (
      <button className={btn} onClick={download}>
        <Download size={11} /> Download update
      </button>
    )
  } else if (status === 'downloaded') {
    action = (
      <button className={btn} onClick={() => window.api.installUpdate()}>
        <RotateCw size={11} /> Install &amp; restart
      </button>
    )
  } else if (status === 'error') {
    action = (
      <button className={btn} onClick={check}>
        <RefreshCw size={11} /> Try again
      </button>
    )
  } else {
    action = (
      <button className={btn} onClick={check} disabled={status === 'checking'}>
        <RefreshCw size={11} /> {status === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
    )
  }

  return (
    <>
      <Section
        title="About"
        description="RADAR — TerraByte’s personal project radar. Every project is a blip fed by a per-project BLIP.md your AI coding agent keeps current via /blip."
        keywords="about version radar terrabyte identity build app"
      >
        <SettingRow label="Version" help="The installed RADAR build.">
          <div className="flex items-center justify-between gap-3">
            <span className="font-lcd text-[22px] text-phosphor phosphor-glow">v{version || '—'}</span>
            <button
              onClick={() => window.open(REPO)}
              className="inline-flex items-center gap-1.5 border border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted transition-colors hover:border-phosphor hover:text-phosphor"
            >
              <ExternalLink size={11} /> Repository
            </button>
          </div>
        </SettingRow>
      </Section>

      <Section
        title="Updates"
        description="RADAR updates itself in the background on packaged builds. Check manually here."
        keywords="updates check download install version electron upgrade release"
      >
        <SettingRow label="Software update" help="Check for a newer release, download it, and restart to apply.">
          <div className="flex flex-wrap items-center gap-3">
            {action}
            <StatusLine status={status} availableVer={availableVer} progress={progress} errorMsg={errorMsg} />
          </div>
        </SettingRow>
      </Section>
    </>
  )
}
