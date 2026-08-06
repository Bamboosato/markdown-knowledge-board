import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudApiError,
  disconnectGitHub,
  getGitHubSession,
  signOutGitHub,
  type GitHubUser,
} from '../lib/cloudApi'
import type { CloudCapability } from '../lib/cloudCapability'
import { removeStoredCloudBackupMetadata } from '../lib/cloudMetadata'

export type GitHubSessionState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: GitHubUser }
  | { status: 'reauthorization-required' }
  | { status: 'unavailable'; reason: 'offline' | 'timeout' | 'server' }

type AuthNotice = {
  tone: 'success' | 'warning'
  message: string
  settingsUrl?: string
}

type BusyAction = 'signout' | 'disconnect' | null

function consumeAuthCallbackNotice(): AuthNotice | null {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('auth')
  if (result !== 'connected' && result !== 'error') return null

  const code = url.searchParams.get('code')
  url.searchParams.delete('auth')
  url.searchParams.delete('code')
  window.history.replaceState(window.history.state, '', url)

  if (result === 'connected') {
    return {
      tone: 'success',
      message: 'GitHub connected. Backup and restore run only when you choose them.',
    }
  }
  const messages: Record<string, string> = {
    access_denied: 'GitHub sign-in was cancelled.',
    state_invalid: 'GitHub sign-in expired. Please try again.',
    origin_invalid: 'GitHub sign-in returned to an unexpected address.',
    exchange_failed: 'GitHub sign-in could not be completed.',
    permission_missing: 'The GitHub App does not have the required permission.',
  }
  return {
    tone: 'warning',
    message: messages[code ?? ''] ?? 'GitHub sign-in could not be completed.',
  }
}

export function useGitHubSession(capability: CloudCapability) {
  const enabled = capability === 'enabled'
  const [session, setSession] = useState<GitHubSessionState>(() =>
    enabled ? { status: 'checking' } : { status: 'signed-out' },
  )
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [notice, setNotice] = useState<AuthNotice | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const csrfTokenRef = useRef<string | null>(null)
  const operationRef = useRef(0)

  const checkSession = useCallback(async (
    preserveNotice = false,
    preserveStatus = false,
  ): Promise<GitHubSessionState> => {
    if (!enabled) return { status: 'signed-out' }
    const operation = ++operationRef.current
    if (!preserveNotice) setNotice(null)
    if (!navigator.onLine) {
      const next: GitHubSessionState = {
        status: 'unavailable',
        reason: 'offline',
      }
      setSession(next)
      return next
    }
    if (!preserveStatus) setSession({ status: 'checking' })
    try {
      const result = await getGitHubSession()
      if (operation !== operationRef.current) return { status: 'checking' }
      csrfTokenRef.current = result.csrfToken
      setCsrfToken(result.csrfToken)
      const next: GitHubSessionState =
        result.status === 'signed-in'
          ? { status: 'signed-in', user: result.user }
          : { status: result.status }
      setSession(next)
      return next
    } catch (error) {
      if (operation !== operationRef.current) return { status: 'checking' }
      const reason =
        !navigator.onLine ||
        (error instanceof CloudApiError && error.code === 'OFFLINE')
          ? 'offline'
          : error instanceof CloudApiError &&
              (error.code === 'CLIENT_TIMEOUT' ||
                error.code === 'SESSION_CHECK_TIMEOUT')
            ? 'timeout'
            : 'server'
      const next: GitHubSessionState = { status: 'unavailable', reason }
      setSession(next)
      setNotice({
        tone: 'warning',
        message:
          error instanceof CloudApiError
            ? error.message
            : 'GitHub is temporarily unavailable.',
      })
      return next
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const task = window.setTimeout(() => {
      const callbackNotice = consumeAuthCallbackNotice()
      setNotice(callbackNotice)
      void checkSession(callbackNotice !== null)
    }, 0)
    return () => window.clearTimeout(task)
  }, [checkSession, enabled])

  useEffect(() => {
    if (!enabled) return
    const handleOffline = () => {
      operationRef.current += 1
      setIsOnline(false)
      setSession({ status: 'unavailable', reason: 'offline' })
    }
    const handleOnline = () => setIsOnline(true)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkSession(false, true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkSession, enabled])

  const requireReauthorization = useCallback(() => {
    operationRef.current += 1
    csrfTokenRef.current = null
    setCsrfToken(null)
    setNotice(null)
    setSession({ status: 'reauthorization-required' })
  }, [])

  const signOut = useCallback(async () => {
    const csrfToken = csrfTokenRef.current
    if (!csrfToken || busyAction) return false
    setBusyAction('signout')
    setNotice(null)
    try {
      await signOutGitHub(csrfToken)
      operationRef.current += 1
      csrfTokenRef.current = null
      setCsrfToken(null)
      setSession({ status: 'signed-out' })
      setNotice({
        tone: 'success',
        message: 'Signed out. Local notes were not changed.',
      })
      return true
    } catch (error) {
      setNotice({
        tone: 'warning',
        message:
          error instanceof CloudApiError
            ? error.message
            : 'GitHub sign-out could not be completed.',
      })
      return false
    } finally {
      setBusyAction(null)
    }
  }, [busyAction])

  const disconnect = useCallback(async () => {
    const csrfToken = csrfTokenRef.current
    if (!csrfToken || busyAction) return false
    const userId = session.status === 'signed-in' ? session.user.id : null
    setBusyAction('disconnect')
    setNotice(null)
    try {
      const result = await disconnectGitHub(csrfToken)
      operationRef.current += 1
      csrfTokenRef.current = null
      setCsrfToken(null)
      if (userId !== null) removeStoredCloudBackupMetadata(userId)
      setSession({ status: 'signed-out' })
      setNotice(
        result.revocation === 'succeeded'
          ? {
              tone: 'success',
              message:
                'GitHub disconnected. Local notes and the encrypted Gist were not deleted.',
            }
          : {
              tone: 'warning',
              message:
                'This browser was disconnected, but GitHub token revocation could not be confirmed.',
              settingsUrl: result.githubSettingsUrl,
            },
      )
      return true
    } catch (error) {
      setNotice({
        tone: 'warning',
        message:
          error instanceof CloudApiError
            ? error.message
            : 'GitHub could not be disconnected.',
      })
      return false
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, session])

  return {
    session,
    isOnline,
    notice,
    busyAction,
    csrfToken,
    retry: () => checkSession(false, false),
    refresh: () => checkSession(false, true),
    clearNotice: () => setNotice(null),
    requireReauthorization,
    signOut,
    disconnect,
  }
}
