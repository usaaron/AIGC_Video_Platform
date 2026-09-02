import { lazy } from 'react'

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })))
}

export const AssetsPage = lazyNamed(() => import('../pages/AssetsPage'), 'AssetsPage')
export const AssetLibraryPage = lazyNamed(() => import('../pages/AssetLibraryPage'), 'AssetLibraryPage')
export const BillingPage = lazyNamed(() => import('../pages/BillingPage'), 'BillingPage')
export const FilmPage = lazyNamed(() => import('../pages/FilmPage'), 'FilmPage')
export const GenerationPage = lazyNamed(() => import('../pages/GenerationPage'), 'GenerationPage')
export const OverviewPage = lazyNamed(() => import('../pages/OverviewPage'), 'OverviewPage')
export const ProjectHomePage = lazyNamed(() => import('../pages/ProjectHomePage'), 'ProjectHomePage')
export const FunctionStackPage = lazyNamed(() => import('../pages/FunctionStackPage'), 'FunctionStackPage')
export const ScriptPage = lazyNamed(() => import('../pages/ScriptPage'), 'ScriptPage')
export const SettingsPage = lazyNamed(() => import('../pages/SettingsPage'), 'SettingsPage')
export const StoryboardPage = lazyNamed(() => import('../pages/StoryboardPage'), 'StoryboardPage')
