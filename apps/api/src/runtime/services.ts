import type { AppConfig } from '../config.js'
import { FilmPreviewComposer, type FilmPreviewDispatcher } from '../core/film/filmPreviewComposer.js'
import { createMailer, type Mailer } from '../core/email/mailer.js'
import { OutboxRepository } from '../core/jobs/outbox.js'
import type { TaskDispatcher } from '../core/jobs/taskDispatcher.js'
import type { ObjectStorage } from '../infra/objectStorage.js'
import type { AccountDatabase } from '../infra/postgres.js'
import type { AppStore } from '../infra/store.js'
import { AccountManagementRepository } from '../modules/accountManagement/repository.js'
import { AccountManagementService } from '../modules/accountManagement/service.js'
import { AiJobRepository } from '../modules/aiJobs/repository.js'
import { AiJobService } from '../modules/aiJobs/service.js'
import { AdminRepository } from '../modules/admin/repository.js'
import { AuthRepository } from '../modules/auth/repository.js'
import { AuthService } from '../modules/auth/service.js'
import { StoreCreditLedger } from '../modules/billing/creditLedger.js'
import { BillingPaymentRepository } from '../modules/billing/paymentRepository.js'
import {
  StripeBillingPaymentProvider,
  type BillingPaymentProvider,
} from '../modules/billing/paymentProvider.js'
import { BillingPaymentService } from '../modules/billing/paymentService.js'
import { GenerationTaskRepository } from '../modules/generation/repository.js'
import { GenerationService } from '../modules/generation/service.js'
import { MediaRepository } from '../modules/media/repository.js'
import { MediaService } from '../modules/media/service.js'
import { NovelRepository } from '../modules/novels/repository.js'
import { NovelService } from '../modules/novels/service.js'
import { ProjectRepository } from '../modules/projects/repository.js'
import { ProjectService } from '../modules/projects/service.js'
import { QuickStartService } from '../modules/quickStart/service.js'
import { TrustedAssetService } from '../modules/trustedAssets/service.js'
import { UserRepository } from '../modules/users/repository.js'
import { videoProviderName, type RuntimeProviders } from './providers.js'

export type RuntimeRepositories = {
  users: UserRepository
  authAccounts: AuthRepository | UserRepository
  adminRepository: AdminRepository | null
  projectRepository: ProjectRepository
  generationTaskRepository: GenerationTaskRepository
  aiJobRepository: AiJobRepository
  outboxRepository: OutboxRepository | null
  creditLedger: StoreCreditLedger
  refreshProjectDomainRuntimeCache: (() => Promise<void>) | null
}

export type RuntimeServices = {
  authService: AuthService
  accountManagementService: AccountManagementService | null
  generationService: GenerationService
  projectService: ProjectService
  novelService: NovelService
  aiJobService: AiJobService
  quickStartService: QuickStartService
  mediaService: MediaService
  trustedAssetService: TrustedAssetService
  paymentService: BillingPaymentService | null
}

export type RuntimeDispatchers = {
  taskDispatcher: TaskDispatcher
  aiJobDispatcher: TaskDispatcher
}

export async function createRuntimeRepositories(input: {
  config: AppConfig
  store: AppStore
  database: AccountDatabase | null
}): Promise<RuntimeRepositories> {
  const { config, store, database } = input
  const users = new UserRepository(store, database)
  if (config.BOOTSTRAP_ACCOUNTS_ON_START) {
    await users.bootstrapFromStore()
  }

  const projectRepository = new ProjectRepository(store, database)
  await projectRepository.refreshRuntimeCacheFromDatabase()

  const creditLedger = new StoreCreditLedger(store, users, false, database)
  if (config.BOOTSTRAP_ACCOUNTS_ON_START) {
    await creditLedger.bootstrapFromStore()
  }

  const outboxRepository =
    database && config.TASK_QUEUE_DRIVER === 'bullmq' ? new OutboxRepository(database) : null
  const generationTaskRepository = new GenerationTaskRepository(
    store,
    creditLedger,
    database,
    outboxRepository,
  )
  await generationTaskRepository.refreshRuntimeCacheFromDatabase()

  const aiJobRepository = new AiJobRepository(store, creditLedger, database, outboxRepository)
  await aiJobRepository.refreshRuntimeCacheFromDatabase()

  const refreshProjectDomainRuntimeCache = database
    ? async () => {
        await projectRepository.refreshRuntimeCacheFromDatabase()
        await generationTaskRepository.refreshRuntimeCacheFromDatabase()
        await aiJobRepository.refreshRuntimeCacheFromDatabase()
      }
    : null

  return {
    users,
    authAccounts: database ? new AuthRepository(database) : users,
    adminRepository: database ? new AdminRepository(database) : null,
    projectRepository,
    generationTaskRepository,
    aiJobRepository,
    outboxRepository,
    creditLedger,
    refreshProjectDomainRuntimeCache,
  }
}

export function createRuntimeFilmPreviewComposer(input: {
  config: AppConfig
  store: AppStore
  objectStorage: ObjectStorage
  providers: RuntimeProviders
  filmPreviewComposerOverride?: FilmPreviewDispatcher | null
}): FilmPreviewDispatcher | null {
  const { config, store, objectStorage, providers, filmPreviewComposerOverride } = input
  if (filmPreviewComposerOverride !== undefined) return filmPreviewComposerOverride
  if (!providers.videoProvider) return null
  return new FilmPreviewComposer(
    store,
    providers.videoProvider,
    objectStorage,
    config.FFMPEG_PATH,
    config.FILM_PREVIEW_TIMEOUT_MS,
    videoProviderName(config),
  )
}

export function createRuntimeServices(input: {
  config: AppConfig
  store: AppStore
  database: AccountDatabase | null
  objectStorage: ObjectStorage
  providers: RuntimeProviders
  repositories: RuntimeRepositories
  dispatchers: RuntimeDispatchers
  filmPreviewComposer: FilmPreviewDispatcher | null
  paymentProviderOverride?: BillingPaymentProvider | null
  mailerOverride?: Mailer | null
}): RuntimeServices {
  const {
    config,
    store,
    database,
    objectStorage,
    providers,
    repositories,
    dispatchers,
    filmPreviewComposer,
    paymentProviderOverride,
    mailerOverride,
  } = input

  const mailer = mailerOverride ?? createMailer(config)
  const authService = new AuthService(repositories.authAccounts, config.AUTH_SECRET, {
    exposePasswordResetTokens: config.NODE_ENV !== 'production',
    mailer,
    passwordResetUrl: config.AUTH_PASSWORD_RESET_URL,
  })
  const accountManagementService = database
    ? new AccountManagementService(
        new AccountManagementRepository(database),
        repositories.users,
        store,
        config.AUTH_SECRET,
        config.WEB_ORIGIN,
        mailer,
        config.AUTH_INVITATION_URL,
      )
    : null
  const generationService = new GenerationService(
    repositories.generationTaskRepository,
    dispatchers.taskDispatcher,
    providers.videoProvider,
    videoProviderName(config),
    objectStorage,
    filmPreviewComposer,
  )
  const projectService = new ProjectService(
    repositories.projectRepository,
    providers.textProvider,
    repositories.creditLedger,
  )
  const novelService = new NovelService(
    new NovelRepository(store, database, objectStorage),
    providers.textProvider,
    repositories.creditLedger,
    repositories.aiJobRepository,
    dispatchers.aiJobDispatcher,
  )
  const aiJobService = new AiJobService(repositories.aiJobRepository)
  const quickStartService = new QuickStartService(
    store,
    providers.textProvider,
    dispatchers.taskDispatcher,
    Boolean(providers.imageProvider),
    repositories.creditLedger,
  )
  const mediaService = new MediaService(new MediaRepository(store), objectStorage)
  const trustedAssetService = new TrustedAssetService(
    store,
    providers.assetLibraryProvider,
    objectStorage,
    config.AUTH_SECRET,
    config.PUBLIC_API_BASE_URL.replace(/\/+$/, ''),
    config.VOLC_ARK_PROJECT_NAME,
    config.ASSET_LIBRARY_CONSOLE_URL,
    repositories.projectRepository,
  )
  const paymentProvider =
    paymentProviderOverride !== undefined ? paymentProviderOverride : createRuntimePaymentProvider(config)
  const paymentService =
    database && paymentProvider
      ? new BillingPaymentService(
          new BillingPaymentRepository(database),
          repositories.creditLedger,
          paymentProvider,
          {
            successUrl: billingRedirectUrl(config.BILLING_SUCCESS_URL, config.WEB_ORIGIN, '/billing/success'),
            cancelUrl: billingRedirectUrl(config.BILLING_CANCEL_URL, config.WEB_ORIGIN, '/billing/cancelled'),
            memberPriceId: config.STRIPE_MEMBER_PRICE_ID,
            creditPriceId: config.STRIPE_CREDIT_PRICE_ID,
            creditPackCredits: config.STRIPE_CREDIT_PACK_CREDITS,
          },
        )
      : null

  return {
    authService,
    accountManagementService,
    generationService,
    projectService,
    novelService,
    aiJobService,
    quickStartService,
    mediaService,
    trustedAssetService,
    paymentService,
  }
}

function createRuntimePaymentProvider(config: AppConfig): BillingPaymentProvider | null {
  if (config.PAYMENT_PROVIDER !== 'stripe') return null
  return new StripeBillingPaymentProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET)
}

function billingRedirectUrl(configured: string, webOrigin: string, path: string): string {
  if (configured) return configured
  return `${webOrigin.replace(/\/+$/, '')}${path}`
}
