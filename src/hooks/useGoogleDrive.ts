import { useCallback, useEffect, useRef, useState } from 'react'
import { DriveError, getDriveAccount, type DriveAccount } from '../lib/googleDrive'
import {
  googleConfigured,
  prepareGoogleIdentity,
  requestGoogleToken,
  revokeGoogleToken,
} from '../lib/googleIdentity'

export type GoogleDriveStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'signed-in' | 'reauthorization-required'

export function useGoogleDrive() {
  const configured = googleConfigured()
  const [status, setStatus] = useState<GoogleDriveStatus>(configured ? 'signed-out' : 'unconfigured')
  const [account, setAccount] = useState<DriveAccount | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    if (configured) void prepareGoogleIdentity().catch(() => undefined)
  }, [configured])

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    const timer = window.setInterval(() => {
      if (tokenRef.current && tokenRef.current.expiresAt <= Date.now() + 30_000) {
        tokenRef.current = null
        setStatus('reauthorization-required')
      }
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [status])

  const signOut = useCallback(() => {
    generationRef.current += 1
    tokenRef.current = null
    setAccount(null)
    setStatus(configured ? 'signed-out' : 'unconfigured')
    setNotice(null)
  }, [configured])

  const connect = useCallback(async () => {
    if (!configured) { setNotice('Google Drive is not configured for this deployment.'); return false }
    const generation = ++generationRef.current
    setBusy(true)
    setStatus('connecting')
    setNotice(null)
    try {
      const token = await requestGoogleToken(!!account)
      const nextAccount = await getDriveAccount(token.token)
      if (generation !== generationRef.current) return false
      tokenRef.current = token
      setAccount(nextAccount)
      setStatus('signed-in')
      return true
    } catch (error) {
      if (generation !== generationRef.current) return false
      setStatus(account ? 'reauthorization-required' : 'signed-out')
      setNotice(error instanceof Error ? error.message : 'Google Drive could not be connected.')
      return false
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }, [account, configured])

  const token = useCallback(() => {
    if (status !== 'signed-in' || !tokenRef.current || tokenRef.current.expiresAt <= Date.now() + 30_000) {
      setStatus('reauthorization-required')
      throw new Error('Connect Google Drive again before continuing.')
    }
    return tokenRef.current.token
  }, [status])

  const handleError = useCallback((error: unknown) => {
    if (error instanceof DriveError && error.status === 401) {
      tokenRef.current = null
      setStatus('reauthorization-required')
    }
    setNotice(error instanceof Error ? error.message : 'Google Drive operation failed.')
  }, [])

  const disconnect = useCallback(async () => {
    if (!tokenRef.current) {
      setStatus('reauthorization-required')
      setNotice('Reconnect to Google Drive before removing its permission.')
      return false
    }
    setBusy(true)
    try {
      await revokeGoogleToken(tokenRef.current.token)
      signOut()
      return true
    } catch (error) {
      handleError(error)
      return false
    } finally { setBusy(false) }
  }, [handleError, signOut])

  return {
    status, account, busy, isOnline, notice, token, connect, signOut, disconnect, handleError,
    clearNotice: () => setNotice(null),
  }
}
