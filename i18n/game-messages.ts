// Stable data-error codes and canonical English compatibility DTOs only.
// Never compare localized player-facing strings; unknown provider errors use a safe fallback.
const codes = new Map<string, string>(
  Object.entries({
    "42501": "cardErrors.yourDataIsTemporarilyUnavailableRefreshThePage",
    AUTH_REQUIRED: "cardErrors.authRequired",
    PROFILE_MISSING: "cardErrors.profileMissing",
    PACK_NOT_READY: "cardErrors.packNotReady",
    INVALID_PACK_COUNT: "cardErrors.invalidPackCount",
    INSUFFICIENT_PACKS: "cardErrors.insufficientPacks",
    CATALOGUE_INCOMPLETE: "cardErrors.catalogueIncomplete",
    THREE_DISTINCT_LR_COPIES_REQUIRED:
      "cardErrors.threeDistinctLrCopiesRequired",
    FIVE_DISTINCT_LR_COPIES_REQUIRED:
      "cardErrors.threeDistinctLrCopiesRequired",
    INVALID_LR_COPIES: "cardErrors.invalidLrCopies",
    FIVE_DISTINCT_SSR_COPIES_REQUIRED:
      "cardErrors.fiveDistinctSsrCopiesRequired",
    INVALID_SSR_COPIES: "cardErrors.invalidSsrCopies",
    SSR_CARD_NOT_OWNED: "cardErrors.ssrCardNotOwned",
    NOT_ENOUGH_SSR_COPIES: "cardErrors.notEnoughSsrCopies",
    DECISION_PACK_NOT_READY: "cardErrors.decisionPackNotReady",
    DECISION_PACK_NOT_PENDING: "cardErrors.decisionPackNotPending",
    DECISION_CHOICE_UNAVAILABLE: "cardErrors.decisionChoiceUnavailable",
    DECISION_LAST_CHOICE: "cardErrors.decisionLastChoice",
    CARD_NOT_OWNED: "cardErrors.cardNotOwned",
    CARD_FROZEN: "cardErrors.cardFrozen",
    CARD_LOCKED: "cardErrors.cardLocked",
    INVALID_CARD_SELECTION: "cardErrors.invalidCardSelection",
    FOLDER_NAME_TAKEN: "cardErrors.folderNameTaken",
    FOLDER_NOT_FOUND: "cardErrors.folderNotFound",
    PGRST301: "cardErrors.authRequired"
  })
);
codes.set("PRO_REQUIRED", "cardErrors.thisFeatureIsAvailableToProMembersOnly");
codes.set(
  "INVALID_IMGUR_URL",
  "cardErrors.enterAValidImgurLinkStartingWithHttps"
);
const englishMessages = new Map<string, string>(
  Object.entries({
    "Sign in to view your collection and packs.": "cardErrors.authRequired",
    "Your profile couldn't be found. The game couldn't be loaded.":
      "cardErrors.profileMissing",
    "No packs available right now.": "cardErrors.packNotReady",
    "Choose 1, 5, or 10 Regular Packs.": "cardErrors.invalidPackCount",
    "You don't have enough packs for this batch. Choose a smaller quantity.":
      "cardErrors.insufficientPacks",
    "The catalog isn't ready yet. Please try again later.":
      "cardErrors.catalogueIncomplete",
    "Choose exactly three different copies of the same normal LR card.":
      "cardErrors.threeDistinctLrCopiesRequired",
    "Only three identical normal LR copies can evolve. Shiny and evolved cards are excluded.":
      "cardErrors.invalidLrCopies",
    "Choose exactly five different copies of the same standard SSR card.":
      "cardErrors.fiveDistinctSsrCopiesRequired",
    "Choose five identical standard SSR copies.": "cardErrors.invalidSsrCopies",
    "This SSR copy is no longer in your collection.":
      "cardErrors.ssrCardNotOwned",
    "You need five identical SSR copies for this evolution.":
      "cardErrors.notEnoughSsrCopies",
    "Your daily Decision Pack isn't available yet.":
      "cardErrors.decisionPackNotReady",
    "This Decision Pack is no longer available.":
      "cardErrors.decisionPackNotPending",
    "This Decision Pack card is no longer available.":
      "cardErrors.decisionChoiceUnavailable",
    "You must keep the last card.": "cardErrors.decisionLastChoice",
    "This card is no longer in your collection.": "cardErrors.cardNotOwned",
    "This card is listed in an auction and can't be destroyed.":
      "cardErrors.cardFrozen",
    "This card is locked. Unlock it before doing this.":
      "cardErrors.cardLocked",
    "Invalid card selection. Select between 1 and 500 copies.":
      "cardErrors.invalidCardSelection",
    "A folder with this name already exists.": "cardErrors.folderNameTaken",
    "This folder no longer exists.": "cardErrors.folderNotFound",
    "This feature is available to Pro members only.":
      "collectionUi.thisFeatureIsAvailableToProMembersOnly",
    "Enter a valid Imgur link starting with https://i.imgur.com/ or https://imgur.com/.":
      "cardErrors.enterAValidImgurLinkStartingWithHttps",
    "Your data is temporarily unavailable. Refresh the page or sign in again.":
      "cardErrors.yourDataIsTemporarilyUnavailableRefreshThePage",
    "Couldn't reach game data. Please try again in a moment.":
      "cardErrors.couldntReachGameDataPleaseTryAgainIn",
    "This binder can't be added to favorites.":
      "cardErrors.thisBinderCantBeAddedToFavorites",
    "This card is already in your collection.":
      "cardErrors.wishlistCardAlreadyOwned",
    "This card couldn't be found.": "cardErrors.wishlistCardNotFound",
    "This binder couldn't be found.": "cardErrors.wishlistBinderKeyRequired",
    "Couldn't resolve this favorite. Please try again.":
      "cardErrors.couldntResolveThisFavoritePleaseTryAgain",
    "You've already reported this issue for this card.":
      "cardErrors.cardReportsReportDuplicate",
    "You've reached today's report limit.": "cardErrors.cardReportsReportLimit",
    "This report is invalid.": "cardErrors.cardReportsReportInvalid",
    "Sign in to report this card.": "cardErrors.cardReportsAuthRequired",
    "Couldn't confirm this choice.": "packs.couldntConfirmThisChoice",
    "Couldn't sell these cards.": "packs.couldntSellTheseCards",
    "Couldn't destroy this card.": "collectionUi.couldntDestroyThisCard",
    "Couldn't destroy the selected cards.":
      "collectionUi.couldntDestroyTheSelectedCards",
    "Couldn't load binders.": "collectionUi.couldntLoadBinders",
    "Couldn't update this favorite.": "collectionUi.couldntUpdateThisFavorite",
    "Couldn't load this binder's cards.":
      "collectionUi.couldntLoadThisBindersCards",
    "Couldn't evolve this card.": "collectionUi.couldntEvolveThisCard",
    "Couldn't create this folder.": "collectionUi.couldntCreateThisFolder",
    "Couldn't create this auction.": "collectionUi.couldntCreateThisAuction",
    "Couldn't customize this image.": "collectionUi.couldntCustomizeThisImage",
    "Couldn't change this card's lock.":
      "collectionUi.couldntChangeThisCardsLock",
    "Couldn't move the selected cards.":
      "collectionUi.couldntMoveTheSelectedCards",
    "Couldn't update your wishlist.": "collectionUi.couldntUpdateYourWishlist",
    "Couldn't load": "collectionUi.couldntLoad",
    "Your cards couldn’t load.": "collectionUi.yourCardsCouldntLoad",
    "Couldn’t refresh your cards. Your last loaded collection is still shown.":
      "collectionUi.couldntRefreshYourCardsYourLastLoadedCollection",
    "Couldn't load this data.": "gameUi.couldntLoadThisData",
    "Couldn't load your cards.": "gameUi.couldntLoadYourCards",
    "Couldn't open this pack.": "gameUi.couldntOpenThisPack",
    "This action is unavailable in the simulation.":
      "gameUi.thisActionIsUnavailableInTheSimulation",
    "Details unavailable.": "catalogueUi.detailsUnavailable",
    "Couldn't complete this action.": "catalogueUi.couldntCompleteThisAction",
    "Owners unavailable.": "catalogueUi.ownersUnavailable",
    "The catalog is temporarily unavailable.":
      "catalogueUi.theCatalogIsTemporarilyUnavailable",
    "Wishlist indisponible.": "catalogueUi.wishlistIndisponible",
    "Couldn't remove this card from your wishlist.":
      "catalogueUi.couldntRemoveThisCardFromYourWishlist",
    "Couldn't save these favorites.": "catalogueUi.couldntSaveTheseFavorites"
  })
);
englishMessages.set(
  "The wishlist is temporarily unavailable.",
  "cardErrors.wishlistUnavailable"
);
englishMessages.set(
  "Couldn't send this report.",
  "collectionShared.couldntSendThisReport"
);
for (const [message, key] of Object.entries({
  "Choose up to 12 licenses per category.": "profileUi.licenseLimitHint",
  "Couldn't save changes.": "profileUi.couldntSaveChanges",
  "Couldn't upload this image.": "profileUi.couldntUploadThisImage",
  "Banner framing is not available yet. Please try again after the update.":
    "profileUi.bannerCropUnavailable",
  "Choose a card you own for your banner.": "profileUi.ownedBannerRequired",
  "Your banner must be 4 MB or smaller.": "profileUi.bannerSizeLimit",
  "Use a JPG, PNG, WebP or GIF image.": "profileUi.useAJPGPNGWebPOrGIFImage",
  "Your profile style couldn't be saved. Try again.":
    "profileUi.styleSaveFailed",
  "Likes are temporarily unavailable.": "profileUi.likesUnavailable",
  "Stats and board are temporarily unavailable.": "profileUi.boardUnavailable",
  "Profile unavailable.": "profileUi.profileUnavailable",
  "Like unavailable.": "profileUi.likeUnavailable",
  "Collection unavailable.": "profileUi.collectionUnavailable",
  "Board updated": "profileUi.boardUpdated",
  "Profile style updated": "profileUi.profileStyleUpdated",
  "Showcase updated": "profileUi.showcaseUpdated",
  "Profile updated": "profileUi.profileUpdated",
  "Couldn't load the wall. Please try again in a moment.":
    "profileUi.wallLoadFailed",
  "JPG, PNG, WebP, or GIF, up to 6 MB.": "profileUi.jpgpngwebPOrGIFUpTo6",
  "Post added to your wall": "profileUi.postAddedToYourWall",
  "Couldn't publish your post. Your draft has been kept.":
    "profileUi.publishFailedDraftKept",
  "Post deleted": "profileUi.postDeleted",
  "Couldn't delete this post.": "profileUi.couldntDeleteThisPost",
  "The wall is unavailable or its access has changed. Please try again.":
    "profileUi.wallAccessChanged",
  "This listing no longer belongs to this profile.":
    "profileUi.listingOwnerChanged",
  "Auction unavailable.": "profileUi.auctionUnavailable",
  "Action saved. Refresh the auction to see its latest status.":
    "profileUi.auctionActionSaved",
  "Couldn't refresh this auction.": "profileUi.couldntRefreshThisAuction",
  "Couldn't update your watchlist.": "profileUi.watchUpdateFailed",
  "Listings unavailable.": "profileUi.listingsUnavailable",
  "Licenses unavailable.": "profileUi.licensesUnavailable",
  "Couldn't load settings.": "settingsUi.couldntLoadSettings",
  "Privacy settings updated": "settingsUi.privacySettingsUpdated",
  "Couldn't save settings.": "settingsUi.couldntSaveSettings",
  "Preparing your data…": "settingsUi.preparingYourData",
  "Download failed.": "settingsUi.downloadFailed",
  "Download started. You can download your data again in 24 hours.":
    "settingsUi.downloadStartedNotice",
  "Download failed. Please try again later.": "settingsUi.downloadRetryLater",
  "Unable to verify your subscription. Retrying automatically.":
    "settingsUi.subscriptionVerificationRetry",
  "A subscription already exists. Your status will update automatically. You can manage your subscription below.":
    "settingsUi.subscriptionExists",
  "Billing is temporarily unavailable. Please try again.":
    "settingsUi.billingUnavailable",
  "Couldn't load this post's activity. Access may have changed.":
    "profileUi.postActivityAccessChanged",
  "File cleanup is unavailable.": "profileUi.fileCleanupIsUnavailable",
  "Couldn't load this post's activity. Please try again.":
    "profileUi.postActivityLoadFailed",
  "Image uploads are unavailable. Please try again.":
    "profileUi.imageUploadUnavailable",
  "Couldn't update this post. Your draft has been kept.":
    "profileUi.postUpdateDraftKept",
  "Thanks, your report has been submitted.": "profileUi.reportSubmitted",
  "Couldn't complete this action.": "catalogueUi.couldntCompleteThisAction",
  "GIF search isn't configured.": "profileUi.gifsearchIsnTConfigured",
  "Couldn't load GIFs.": "profileUi.couldntLoadGIFs",
  "This request is no longer available.": "profileUi.requestUnavailable",
  "This profile couldn't be found.": "profileUi.thisProfileCouldntBeFound",
  "Your bio can contain up to 300 characters.": "profileUi.bioLengthLimit",
  "This URL is not allowed. Use the button to upload your avatar (up to 2,048 characters).":
    "profileUi.avatarUrlInvalid",
  "Your showcase selection exceeds your membership limit.":
    "profileUi.showcaseLimitExceeded",
  "Only friends can view the full collection.":
    "profileUi.collectionFriendsOnly",
  "This profile is private. Only friends can view its collection.":
    "profileUi.privateProfileCollection",
  "Couldn't load profile data.": "settingsUi.couldntLoadProfileData",
  "Couldn't save your dashboard. Each section can contain up to 12 titles of 100 characters.":
    "profileUi.dashboardSaveFailed",
  "Couldn't save your widgets. Choose up to 12 catalog franchises per category; a franchise may have been renamed or removed.":
    "profileUi.widgetSaveFailed",
  "Banner framing is unavailable. Please try again after the update.":
    "profileUi.bannerFramingUnavailable",
  "Your banner framing is invalid.": "profileUi.bannerFramingInvalid",
  "This wall is private. Only their friends can view it.":
    "profileUi.privateWallNotice",
  "Wait a few seconds between posts (up to 30 per hour).":
    "profileUi.postRateLimit",
  "Your wall already has 500 posts. Delete one to continue.":
    "profileUi.wallPostLimit",
  "Write up to 3,000 characters, or add an image or GIF.":
    "profileUi.postContentLimit",
  "Choose a GIF from the picker.": "profileUi.chooseAGIFFromThePicker",
  "The image is no longer available. Choose it again.":
    "profileUi.postImageUnavailable",
  "The wall is temporarily unavailable. Please try again in a moment.":
    "profileUi.wallUnavailable",
  "Couldn't finish deleting this post and its files. Please try again.":
    "profileUi.postCleanupFailed",
  "Your wall has reached its 100 MB image quota. Delete an older post with an image to continue.":
    "profileUi.wallStorageLimit",
  "Couldn't upload the image. Your text has been kept.":
    "profileUi.imageUploadDraftKept",
  "Couldn't remove the file. Please try again.": "profileUi.fileRemoveFailed",
  "Your profile photo must be 4 MB or smaller.": "profileUi.avatarSizeLimit",
  "Couldn't upload your profile photo. Please try again.":
    "profileUi.avatarUploadFailed",
  "Couldn't upload your banner. Please try again.":
    "profileUi.bannerUploadFailed",
  "Couldn't load your profile privacy settings.": "profileUi.privacyLoadFailed",
  "Couldn't update your profile privacy settings.":
    "profileUi.privacySaveFailed",
  "Couldn't sign out. Please try again.": "settingsUi.signOutFailed",
  "Sign in again, then return to settings. You must have signed in within the last five minutes.":
    "profileUi.settingsReauthRequired",
  "Enter your username exactly to confirm.":
    "settingsUi.usernameConfirmationHint",
  "Couldn't verify your username. Please try again later.":
    "settingsUi.usernameCheckFailed",
  "The username doesn't match. Enter your username exactly.":
    "settingsUi.usernameMismatch",
  "We couldn't finish deleting your account. Don't submit another request. Contact the team to check its status.":
    "settingsUi.deletionStatusUnknown",
  "Download unavailable.": "settingsUi.downloadUnavailable",
  "Request denied.": "settingsUi.requestDenied",
  "Invalid request.": "settingsUi.invalidRequest",
  "Sign in to download your data.": "settingsUi.signInToDownloadYourData",
  "You can download your data once every 24 hours.":
    "settingsUi.exportCooldownNotice",
  "Your data download is already being prepared.":
    "settingsUi.exportAlreadyPreparing",
  "Your data exceeds the automatic download size limit. Email yokkaicollec@gmail.com with the subject Data export request from your account email address to request a complete export. Do not send your password or sign-in codes. This attempt does not count toward your download limit.":
    "settingsUi.exportSizeLimit",
  "We couldn't prepare your data. Try again; this attempt won't count toward your download limit.":
    "settingsUi.exportPreparationFailed",
  "Sign in to add an image.": "profileUi.signInToAddAnImage",
  "Sign in to finish file cleanup.": "profileUi.signInToFinishFileCleanup",
  "Couldn't finish file cleanup. Please try again.":
    "profileUi.fileCleanupFailed",
  "Couldn't load this page's activity. Please try again.":
    "profileUi.pageActivityLoadFailed",
  "Reporting this content isn't available yet.": "profileUi.reportUnavailable",
  "You've already reported this player in this context.":
    "profileUi.duplicatePlayerReport",
  "You've reached the daily limit of 10 reports.": "profileUi.dailyReportLimit",
  "Couldn't submit this report.": "profileUi.couldntSubmitThisReport",
  "You don't have permission to do this. Sign in again and retry.":
    "profileUi.permissionDenied",
  "Couldn't reach the server. Check your connection and try again.":
    "profileUi.serverUnreachable",
  "Friends are temporarily unavailable. Please try again in a moment.":
    "profileUi.friendsUnavailable",
  "You're already friends with this player.": "profileUi.alreadyFriendsError",
  "You've already sent this player a friend request.":
    "profileUi.friendRequestExists",
  "This player has already sent you a friend request.":
    "profileUi.incomingRequestExists",
  "Couldn't update this profile like. Please try again in a moment.":
    "profileUi.profileLikeFailed",
  "Couldn't load franchises. Please try again in a moment.":
    "profileUi.franchisesLoadFailed",
  "This banner crop is invalid. Adjust the image and try again.":
    "profileUi.bannerCropInvalid",
  "Choose a card you own from your collection for your banner.":
    "profileUi.bannerOwnershipRequired",
  "This banner is not allowed. Upload a JPG, PNG, WebP or GIF image using the banner button.":
    "profileUi.bannerSourceInvalid",
  "Active listings are temporarily unavailable.":
    "profileUi.activeListingsUnavailable",
  "Sign in again to view this auction.": "profileUi.auctionReauthRequired",
  "Couldn't load or update this post. Access may have changed. Please try again.":
    "profileUi.postAccessChanged",
  "Write up to 1,000 characters, or add an image or GIF.":
    "profileUi.replyContentLimit",
  "You can add up to 8 different reactions to a post. Remove one to add another.":
    "profileUi.reactionLimit",
  "Please wait a few seconds between replies (up to 30 per hour).":
    "profileUi.replyRateLimit",
  "This post has reached its reply limit.": "profileUi.postReplyLimit",
  "You can't add yourself as a friend.": "profileUi.selfFriendshipDenied",
  "This friendship is no longer available.": "profileUi.friendshipUnavailable",
  "You've sent too many friend requests. Try again later.":
    "profileUi.friendRequestRateLimit",
  "You can send a new request to this player later.":
    "profileUi.friendRequestCooldown",
  "Reply published": "profileUi.replyPublished",
  "Reply deleted": "profileUi.replyDeleted",
  "Sign in again to create your referral link.":
    "settingsUi.referralReauthRequired",
  "Couldn't create your referral link. Please try again.":
    "settingsUi.referralLinkFailed"
}))
  englishMessages.set(message, key);
for (const [message, key] of Object.entries({
  "Chat unavailable.": "profileUi.chatUnavailable",
  "This auction is currently unavailable.":
    "profileUi.auctionCurrentlyUnavailable",
  "Couldn't place this bid.": "profileUi.couldntPlaceThisBid",
  "Couldn't cancel this listing.": "profileUi.couldntCancelThisListing",
  "Couldn't send this message.": "profileUi.couldntSendThisMessage"
}))
  englishMessages.set(message, key);
for (const [message, key] of Object.entries({
  "Sign in to continue.": "profileUi.signInToContinue",
  "Your account is banned.": "profileUi.yourAccountIsBanned",
  "You've reached your profile image upload limit. Try again later.":
    "profileUi.profileImageRateLimit",
  "Please wait a moment before trying again.": "profileUi.actionCooldown",
  "Check your selection and try again.": "profileUi.selectionInvalid",
  "Your image must be 4 MB or smaller.": "profileUi.profileImageSizeLimit",
  "This feature is temporarily unavailable. Please try again.":
    "profileUi.featureUnavailable"
}))
  englishMessages.set(message, key);
for (const [code, key] of Object.entries({
  PROFILE_NOT_FOUND: "profileUi.thisProfileCouldntBeFound",
  BIO_TOO_LONG: "profileUi.bioLengthLimit",
  AVATAR_URL_INVALID: "profileUi.avatarUrlInvalid",
  FEATURED_CARDS_INVALID: "profileUi.showcaseLimitExceeded",
  FRIENDS_ONLY: "profileUi.collectionFriendsOnly",
  PROFILE_PRIVATE: "profileUi.privateProfileCollection"
}))
  if (!codes.has(code)) codes.set(code, key);
for (const [message, key] of Object.entries({
  "Slow down. Please try again in a few seconds.": "profileUi.chatRateLimit",
  "You can mention up to 3 different people per message.":
    "profileUi.chatMentionLimit",
  "This auction has ended.": "profileUi.thisAuctionHasEnded",
  "Only the seller can cancel this listing.":
    "profileUi.sellerCancellationOnly",
  "You can't bid on your own listing.": "profileUi.selfBidDenied",
  "Your bid must be at least 10 Karas above the current bid.":
    "profileUi.minimumBidIncrement",
  "You don't have enough Karas.": "profileUi.youDontHaveEnoughKaras",
  "This auction couldn't be found.": "profileUi.thisAuctionCouldntBeFound",
  "You must place a bid to join the chat.":
    "profileUi.youMustPlaceABidToJoinThe",
  "Only the seller and bidders can join the chat.":
    "profileUi.chatParticipantsOnly",
  "Messages must contain 1–500 characters.": "profileUi.chatContentLimit",
  "This GIF is invalid.": "profileUi.thisGIFIsInvalid",
  "You can only mention the seller or a player who has already bid.":
    "profileUi.chatMentionParticipantsOnly",
  "Couldn't reach the market. Please try again.": "profileUi.marketUnreachable"
}))
  englishMessages.set(message, key);
const keys = new Set([...codes.values(), ...englishMessages.values()]);
export function gameErrorKey(
  error: unknown,
  fallback = "cardErrors.couldntReachGameDataPleaseTryAgainIn"
) {
  if (typeof error === "string")
    return keys.has(error)
      ? error
      : (englishMessages.get(error) ?? codes.get(error) ?? fallback);
  if (error && typeof error === "object") {
    const value = error as {
      message?: unknown;
      code?: unknown;
      cause?: { i18nKey?: unknown };
    };
    const key = value.cause?.i18nKey;
    if (typeof key === "string" && keys.has(key)) return key;
    if (typeof value.message === "string")
      return (
        codes.get(value.message) ??
        englishMessages.get(value.message) ??
        (typeof value.code === "string" ? codes.get(value.code) : undefined) ??
        fallback
      );
  }
  return fallback;
}
