import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../services/api', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSessionMessages: vi.fn(),
  deleteSession: vi.fn(),
  getModels: vi.fn(),
  setModel: vi.fn(),
  streamChat: vi.fn(),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
  listSessionFavorites: vi.fn(),
  addSessionFavorite: vi.fn(),
  removeSessionFavorite: vi.fn(),
  renameSession: vi.fn(),
  searchKB: vi.fn(),
}))

import * as api from '../../services/api'
import { useChatStore } from '../chat'

const mockApi = api as unknown as {
  listSessions: ReturnType<typeof vi.fn>
  createSession: ReturnType<typeof vi.fn>
  getSessionMessages: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
  getModels: ReturnType<typeof vi.fn>
  setModel: ReturnType<typeof vi.fn>
  streamChat: ReturnType<typeof vi.fn>
  listFavorites: ReturnType<typeof vi.fn>
  addFavorite: ReturnType<typeof vi.fn>
  deleteFavorite: ReturnType<typeof vi.fn>
  listSessionFavorites: ReturnType<typeof vi.fn>
  addSessionFavorite: ReturnType<typeof vi.fn>
  removeSessionFavorite: ReturnType<typeof vi.fn>
  renameSession: ReturnType<typeof vi.fn>
  searchKB: ReturnType<typeof vi.fn>
}

describe('useChatStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      models: [],
      currentModel: null,
      favorites: [],
      sessionFavorites: [],
      streamStates: new Map(),
      kbResults: [],
      kbQuery: '',
    })
  })

  it('has correct initial state', () => {
    const state = useChatStore.getState()
    expect(state.sessions).toEqual([])
    expect(state.messages).toEqual([])
    expect(state.models).toEqual([])
    expect(state.currentModel).toBeNull()
    expect(state.favorites).toEqual([])
    expect(state.sessionFavorites).toEqual([])
    expect(state.currentSessionId).toBeNull()
    expect(state.kbResults).toEqual([])
    expect(state.kbQuery).toBe('')
  })

  it('loadSessions() loads sessions and sets first as current', async () => {
    const sessions = [
      { id: 's1', name: 'Session 1', createdAt: 1000, messageCount: 5 },
      { id: 's2', name: 'Session 2', createdAt: 2000, messageCount: 3 },
    ]
    mockApi.listSessions.mockResolvedValue(sessions)
    mockApi.getSessionMessages.mockResolvedValue([{ role: 'user', content: 'hi', timestamp: 1 }])

    await useChatStore.getState().loadSessions()

    const state = useChatStore.getState()
    expect(state.sessions).toEqual(sessions)
    expect(state.currentSessionId).toBe('s1')
    expect(mockApi.getSessionMessages).toHaveBeenCalledWith('s1')
  })

  it('createSession() creates a new session and sets it as current', async () => {
    mockApi.createSession.mockResolvedValue({ id: 'new1' })

    await useChatStore.getState().createSession()

    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('new1')
    expect(state.messages).toEqual([])
    expect(state.sessions[0].id).toBe('new1')
  })

  it('deleteSession(id) removes the session', async () => {
    useChatStore.setState({
      sessions: [
        { id: 's1', name: 'S1', createdAt: 1, messageCount: 0 },
        { id: 's2', name: 'S2', createdAt: 2, messageCount: 0 },
      ],
      currentSessionId: 's1',
    })
    mockApi.getSessionMessages.mockResolvedValue([])

    await useChatStore.getState().deleteSession('s1')

    const state = useChatStore.getState()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].id).toBe('s2')
    expect(state.currentSessionId).toBe('s2')
  })

  it('abort() does nothing when no active stream', () => {
    expect(() => useChatStore.getState().abort()).not.toThrow()
  })

  it('loadModels() loads models and sets currentModel', async () => {
    const models = [
      { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
      { provider: 'anthropic', id: 'claude', name: 'Claude' },
    ]
    mockApi.getModels.mockResolvedValue({ models, current: null })

    await useChatStore.getState().loadModels()

    const state = useChatStore.getState()
    expect(state.models).toEqual(models)
    expect(state.currentModel).toEqual({ provider: 'openai', id: 'gpt-4' })
  })

  it('setKBQuery() updates query string', () => {
    useChatStore.getState().setKBQuery('test query')
    expect(useChatStore.getState().kbQuery).toBe('test query')
  })
})
