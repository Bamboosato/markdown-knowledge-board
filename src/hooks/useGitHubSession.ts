import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudApiError,
  disconnectGitHub,
  getGitHubSession,
  signOutGitHub,
  type GitHubUser,
} from '../lib/cloudApi'
import type { CloudCapability } from '../lib/cloudCapability'

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
      message: 'GitHub connected. No backup or restore was started.',
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
  const csrfTokenRef = useRef<string | null>(null)
  const operationRef = useRef(0)

  const checkSession = useCallback(async (preserveNotice = false) => {
    if (!enabled) return
    const operation = ++operationRef.current
    if (!preserveNotice) setNotice(null)
    if (!navigator.onLine) {
      setSession({ status: 'unavailable', reason: 'offline' })
      return
    }
    setSession({ status: 'checking' })
    try {
      const result = await getGitHubSession()
      if (operation !== operationRef.current) return
      csrfTokenRef.current = result.csrfToken
      if (result.status === 'signed-in') {
        setSession({ status: 'signed-in', user: result.user })
      } else {
        setSession({ status: result.status })
      }
    } catch (error) {
      if (operation !== operationRef.current) return
      const reason =
        !navigator.onLine ||
        (error instanceof CloudApiError && error.code === 'OFFLINE')
          ? 'offline'
          : error instanceof CloudApiError &&
              (error.code === 'CLIENT_TIMEOUT' ||
                error.code === 'SESSION_CHECK_TIMEOUT')
            ? 'timeout'
            : 'server'
      setSession({ status: 'unavailable', reason })
      setNotice({
        tone: 'warning',
        message:
          error instanceof CloudApiError
            ? error.message
            : 'GitHub is temporarily unavailable.',
      })
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

  const signOut = useCallback(async () => {
    const csrfToken = csrfTokenRef.current
    if (!csrfToken || busyAction) return false
    setBusyAction('signout')
    setNotice(null)
    try {
      await signOutGitHub(csrfToken)
      operationRef.current += 1
      csrfTokenRef.current = null
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
    setBusyAction('disconnect')
    setNotice(null)
    try {
      const result = await disconnectGitHub(csrfToken)
      operationRef.current += 1
      csrfTokenRef.current = null
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
  }, [busyAction])

  return {
    session,
    isOnline,
    notice,
    busyAction,
    retry: checkSession,
    signOut,
    disconnect,
  }
}
