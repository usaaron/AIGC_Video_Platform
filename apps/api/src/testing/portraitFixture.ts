import type { ProviderPortrait } from '../core/generation/volcArkAssetLibraryProvider.js'

export function portrait(groupType: ProviderPortrait['groupType']): ProviderPortrait {
  return {
    assetId: groupType === 'LivenessFace' ? 'asset-live-1' : 'asset-aigc-1',
    groupId: groupType === 'LivenessFace' ? 'group-live-1' : 'group-aigc-1',
    groupType,
    name: '演员甲',
    assetType: 'Image',
    status: 'active',
    previewUrl: 'https://assets.example/portrait.jpg',
    errorCode: null,
    errorMessage: null,
  }
}
