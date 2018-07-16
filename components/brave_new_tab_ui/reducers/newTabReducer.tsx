/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Reducer } from 'redux'

import { types } from '../constants/newTabTypes'
import * as storage from '../storage'

let getGridSitesCache: (state: NewTab.State, checkBookmarkInfo: boolean) => NewTab.Site[]

const getGridSites = (state: NewTab.State, checkBookmarkInfo: boolean) => {
  if (!getGridSitesCache) {
    getGridSitesCache = require('../api').getGridSites
  }

  return getGridSitesCache(state, checkBookmarkInfo)
}

const updateBookmarkInfo = (state: NewTab.State, url: string, bookmarkTreeNode: any) => {
  const bookmarks = Object.assign({}, state.bookmarks)
  const gridSites = state.gridSites.slice()
  const topSites = state.topSites.slice()
  const pinnedTopSites = state.pinnedTopSites.slice()
  // The default empty object is just to avoid null checks below
  const gridSite: Partial<NewTab.Site> = gridSites.find((s) => s.url === url) || {}
  const topSite: Partial<NewTab.Site> = topSites.find((s) => s.url === url) || {}
  const pinnedTopSite: Partial<NewTab.Site> = pinnedTopSites.find((s) => s.url === url) || {}
  gridSite.bookmarked = topSite.bookmarked = pinnedTopSite.bookmarked = !!bookmarkTreeNode
  if (bookmarkTreeNode) {
    bookmarks[url] = bookmarkTreeNode
  } else {
    delete bookmarks[url]
  }
  state = { ...state, bookmarks, gridSites }

  return state
}

const onDraggedSite = (state: NewTab.State, url: string, destUrl: string) => {
  const gridSitesWithoutPreview = getGridSites(state, false)
  const currentPositionIndex = gridSitesWithoutPreview.findIndex(site => site.url === url)
  const finalPositionIndex = gridSitesWithoutPreview.findIndex(site => site.url === destUrl)
  let pinnedTopSites = state.pinnedTopSites.slice()

  // A site that is not pinned yet will become pinned
  const pinnedMovingSite = pinnedTopSites.find(site => site.url === url)
  if (!pinnedMovingSite) {
    const movingTopSite = Object.assign({}, gridSitesWithoutPreview.find(site => site.url === url))
    movingTopSite.index = currentPositionIndex
    movingTopSite.pinned = true
    pinnedTopSites.push(movingTopSite)
  }

  pinnedTopSites = pinnedTopSites.map((pinnedTopSite) => {
    pinnedTopSite = Object.assign({}, pinnedTopSite)
    const currentIndex = pinnedTopSite.index
    if (currentIndex === currentPositionIndex) {
      pinnedTopSite.index = finalPositionIndex
    } else if (currentIndex > currentPositionIndex && pinnedTopSite.index <= finalPositionIndex) {
      pinnedTopSite.index = pinnedTopSite.index - 1
    } else if (currentIndex < currentPositionIndex && pinnedTopSite.index >= finalPositionIndex) {
      pinnedTopSite.index = pinnedTopSite.index + 1
    }
    return pinnedTopSite
  })
  state = { ...state, pinnedTopSites }
  state = { ...state, gridSites: getGridSites(state, false) }
  return state
}

const onDragEnd = (state: NewTab.State) => {
  state = { ...state, gridSites: getGridSites(state, false) }
  return state
}

let calculateGridSites: any
const newTabReducer: Reducer<NewTab.State> = (state: NewTab.State, action) => {
  if (state === undefined) {
    calculateGridSites = require('../api').calculateGridSites
    setImmediate(() => {
      const { fetchTopSites } = require('../api')
      fetchTopSites()
    })
    state = storage.load() || {}
    state = Object.assign(storage.getInitialState(), state)
  }

  const startingState = state
  switch (action.type) {
    case types.BOOKMARK_ADDED:
      const { fetchBookmarkInfo } = require('../api')
      const topSite: NewTab.Site | undefined = state.topSites.find((site) => site.url === action.url)
      if (topSite) {
        chrome.bookmarks.create({
          title: topSite.title,
          url: topSite.url
        }, () => {
          fetchBookmarkInfo(action.url)
        })
      }
      break
    case types.BOOKMARK_REMOVED:
      // TODO somewhere we are saying that bookmarks is Record of booleans, but here we are using id
      const bookmarkInfo = state.bookmarks[action.url]
      if (bookmarkInfo) {
        chrome.bookmarks.remove(bookmarkInfo.id, () => {
          fetchBookmarkInfo(action.url)
        })
      }
      break
    case types.NEW_TAB_TOP_SITES_DATA_UPDATED:
      state = { ...state, topSites: action.topSites }
      calculateGridSites(state)
      break
    case types.NEW_TAB_BACKGROUND_IMAGE_LOAD_FAILED: {
      const source = '/50cc52a4f1743ea74a21da996fe44272.jpg'
      const fallbackImage: NewTab.Image = {
        name: 'Bay Bridge',
        source,
        style: { backgroundImage: 'url(' + source + ')' },
        author: 'Darrell Sano',
        link: 'https://dksfoto.smugmug.com'
      }
      if (!state.imageLoadFailed) {
        state = {
          ...state,
          backgroundImage: fallbackImage,
          imageLoadFailed: true
        }
      } else {
        state = {
          ...state,
          backgroundImage: undefined,
          showImages: false
        }
      }
      break
    }

    case types.NEW_TAB_SITE_PINNED: {
      const topSiteIndex: number = state.topSites.findIndex((site) => site.url === action.url)
      const pinnedTopSite: NewTab.Site = Object.assign({}, state.topSites[topSiteIndex], { pinned: true })
      const pinnedTopSites: NewTab.Site[] = state.pinnedTopSites.slice()

      pinnedTopSite.index = topSiteIndex
      pinnedTopSites.push(pinnedTopSite)
      pinnedTopSites.sort((x, y) => x.index - y.index)
      state = {
        ...state,
        pinnedTopSites
      }
      calculateGridSites(state)
      break
    }

    case types.NEW_TAB_SITE_UNPINNED:
      const currentPositionIndex: number = state.pinnedTopSites.findIndex((site) => site.url === action.url)
      if (currentPositionIndex !== -1) {
        const pinnedTopSites: NewTab.Site[] = state.pinnedTopSites.slice()
        pinnedTopSites.splice(currentPositionIndex, 1)
        state = {
          ...state,
          pinnedTopSites
        }
      }
      calculateGridSites(state)
      break

    case types.NEW_TAB_SITE_IGNORED: {
      const topSiteIndex: number = state.topSites.findIndex((site) => site.url === action.url)
      const ignoredTopSites: NewTab.Site[] = state.ignoredTopSites.slice()
      ignoredTopSites.splice(0, 1, state.topSites[topSiteIndex])
      state = {
        ...state,
        ignoredTopSites,
        showSiteRemovalNotification: true
      }
      calculateGridSites(state)
      break
    }

    case types.NEW_TAB_UNDO_SITE_IGNORED: {
      const ignoredTopSites: NewTab.Site[] = state.ignoredTopSites.slice()
      ignoredTopSites.pop()
      state = {
        ...state,
        ignoredTopSites,
        showSiteRemovalNotification: false
      }
      calculateGridSites(state)
      break
    }

    case types.NEW_TAB_UNDO_ALL_SITE_IGNORED:
      state = {
        ...state,
        ignoredTopSites: [],
        showSiteRemovalNotification: false
      }
      calculateGridSites(state)
      break

    case types.NEW_TAB_HIDE_SITE_REMOVAL_NOTIFICATION:
      state = {
        ...state,
        showSiteRemovalNotification: false
      }
      break

    case types.NEW_TAB_SITE_DRAGGED:
      state = onDraggedSite(state, action.fromUrl, action.toUrl)
      break

    case types.NEW_TAB_SITE_DRAG_END:
      state = onDragEnd(state)
      break

    case types.NEW_TAB_BOOKMARK_INFO_AVAILABLE:
      state = updateBookmarkInfo(state, action.queryUrl, action.bookmarkTreeNode)
      break

    case types.NEW_TAB_GRID_SITES_UPDATED:
      state = { ...state, gridSites: action.gridSites }
      break

    case types.NEW_TAB_STATS_UPDATED:
      state = storage.getLoadTimeData(state)
      break

    case types.NEW_TAB_USE_ALTERNATIVE_PRIVATE_SEARCH_ENGINE:
      state = { ...state, useAlternativePrivateSearchEngine: action.shouldUse }
      break

    default:
      break
  }

  if (state !== startingState) {
    storage.debouncedSave(state)
  }

  return state
}

export default newTabReducer
