import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useDocStore } from '../docs'

vi.mock('../../services/api', () => ({
  fetchDocs: vi.fn(),
  fetchDoc: vi.fn(),
  searchDocs: vi.fn(),
}))

import { fetchDocs, fetchDoc, searchDocs } from '../../services/api'

const mockedFetchDocs = fetchDocs as ReturnType<typeof vi.fn>
const mockedFetchDoc = fetchDoc as ReturnType<typeof vi.fn>
const mockedSearchDocs = searchDocs as ReturnType<typeof vi.fn>

describe('useDocStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDocStore.setState({
      docs: [],
      current: null,
      searchResults: [],
      loading: false,
      searchQuery: '',
    })
  })

  it('has correct initial state', () => {
    const state = useDocStore.getState()
    expect(state.docs).toEqual([])
    expect(state.current).toBeNull()
    expect(state.searchResults).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.searchQuery).toBe('')
  })

  it('load() fetches docs and sets loading=false on success', async () => {
    const fakeDocs = [{ id: '1', title: 'Test', tags: [], keywords: [], intent: '', project_description: '', source_project: '', source_worktree: '', created_at: 0, file_path: '' }]
    mockedFetchDocs.mockResolvedValue(fakeDocs)

    await useDocStore.getState().load()

    const state = useDocStore.getState()
    expect(mockedFetchDocs).toHaveBeenCalledOnce()
    expect(state.docs).toEqual(fakeDocs)
    expect(state.loading).toBe(false)
  })

  it('load() sets loading=false on failure', async () => {
    mockedFetchDocs.mockRejectedValue(new Error('fail'))

    await useDocStore.getState().load()

    const state = useDocStore.getState()
    expect(state.loading).toBe(false)
    expect(state.docs).toEqual([])
  })

  it('select(id) loads a single doc', async () => {
    const fakeDoc = {
      meta: { id: '1', title: 'Test', tags: [], keywords: [], intent: '', project_description: '', source_project: '', source_worktree: '', created_at: 0, file_path: '' },
      content: 'hello',
      truncated: false,
    }
    mockedFetchDoc.mockResolvedValue(fakeDoc)

    await useDocStore.getState().select('1')

    const state = useDocStore.getState()
    expect(mockedFetchDoc).toHaveBeenCalledWith('1')
    expect(state.current).toEqual(fakeDoc)
    expect(state.loading).toBe(false)
  })

  it('search(query) searches docs', async () => {
    const fakeResults = [{ id: '1', title: 'Test', tags: [], keywords: [], intent: '', project_description: '', source_project: '', source_worktree: '', created_at: 0, file_path: '', score: 0.9 }]
    mockedSearchDocs.mockResolvedValue(fakeResults)

    await useDocStore.getState().search('test')

    const state = useDocStore.getState()
    expect(mockedSearchDocs).toHaveBeenCalledWith('test')
    expect(state.searchResults).toEqual(fakeResults)
    expect(state.searchQuery).toBe('test')
  })

  it('search("") clears results', async () => {
    useDocStore.setState({ searchResults: [{ id: '1', title: 'X', tags: [], keywords: [], intent: '', project_description: '', source_project: '', source_worktree: '', created_at: 0, file_path: '', score: 1 }], searchQuery: 'old' })

    await useDocStore.getState().search('')

    const state = useDocStore.getState()
    expect(mockedSearchDocs).not.toHaveBeenCalled()
    expect(state.searchResults).toEqual([])
    expect(state.searchQuery).toBe('')
  })

  it('setSearchQuery() updates query string', () => {
    useDocStore.getState().setSearchQuery('new query')

    expect(useDocStore.getState().searchQuery).toBe('new query')
  })
})
