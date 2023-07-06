import React, { FC, useCallback, useEffect, useState } from 'react'
import { BackHandler, Linking } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { Chat } from '../../components/Chat/Chat.component'
import { communities, publicChannels, messages, files } from '@quiet/state-manager'
import { CancelDownload, FileContent, FileMetadata, FilePreviewData } from '@quiet/types'
import { navigationActions } from '../../store/navigation/navigation.slice'
import { ScreenNames } from '../../const/ScreenNames.enum'
import { UseContextMenuType, useContextMenu } from '../../hooks/useContextMenu'
import { MenuName } from '../../const/MenuNames.enum'
import { DocumentPickerResponse } from 'react-native-document-picker'
import RNFS from 'react-native-fs'
import RNFetchBlob from 'rn-fetch-blob'

export const ChannelScreen: FC = () => {
  const dispatch = useDispatch()

  const handleBackButton = useCallback(() => {
    dispatch(
      navigationActions.navigation({
        screen: ScreenNames.ChannelListScreen,
      })
    )
    dispatch(
      publicChannels.actions.setCurrentChannel({
        channelId: '', // Necessary for marking channels as unread on channel's list
      })
    )
    return true
  }, [dispatch])

  useEffect(() => {
    BackHandler.addEventListener('hardwareBackPress', handleBackButton)
    return () => {
      BackHandler.removeEventListener('hardwareBackPress', handleBackButton)
    }
  }, [handleBackButton])

  const currentChannel = useSelector(publicChannels.selectors.currentChannel)

  const community = useSelector(communities.selectors.currentCommunity)

  const channelMessagesCount = useSelector(publicChannels.selectors.currentChannelMessagesCount)

  const channelMessages = useSelector(publicChannels.selectors.currentChannelMessagesMergedBySender)

  const pendingMessages = useSelector(messages.selectors.messagesSendingStatus)

  const downloadStatusesMapping = useSelector(files.selectors.downloadStatuses)

  let contextMenu: UseContextMenuType<Record<string, unknown>> | null = useContextMenu(MenuName.Channel)
  if (!community?.CA) {
    contextMenu = null
  }

  const [uploadingFiles, setUploadingFiles] = React.useState<FilePreviewData>({})
  const filesRef = React.useRef<FilePreviewData>({})
  React.useEffect(() => {
    filesRef.current = uploadingFiles
  }, [uploadingFiles])

  const downloadFile = useCallback(
    (media: FileMetadata) => {
      dispatch(files.actions.downloadFile(media))
    },
    [dispatch]
  )

  const cancelDownload = useCallback(
    (cancelDownload: CancelDownload) => {
      dispatch(files.actions.cancelDownload(cancelDownload))
    },
    [dispatch]
  )

  // const sendMessageAction = useCallback(
  //   (message: string) => {
  //     dispatch(messages.actions.sendMessage({ message }))
  //   },
  //   [dispatch]
  // )

  const loadMessages = useCallback(
    (load: boolean) => {
      dispatch(messages.actions.lazyLoading({ load }))
    },
    [dispatch]
  )

  const getFileData = (filePath: string): FilePreviewData => {
    const fileContent: FileContent = {
      path: filePath,
      name: 'test',
      ext: 'png',
    }
    const id = `${Date.now()}_${Math.random().toString(36).substring(0, 20)}`
    return { [id]: fileContent }
  }

  const getFilesData = (filePaths: string[]): FilePreviewData => {
    const data = {}
    filePaths.forEach((filePath: string) => {
      Object.assign(data, getFileData(filePath))
    })
    return data
  }

  // Files
  const updateUploadedFiles = (files: DocumentPickerResponse[]) => {
    console.log('FILES', files)
    const filesData: FilePreviewData = getFilesData(files.map(i => i.uri))
    console.log('FILES PATHS', filesData)

    // FilePreviewData
    setUploadingFiles(existingFiles => {
      const updatedFiles = { ...existingFiles, ...filesData }
      return updatedFiles
    })
  }

  const removeFilePreview = (id: string) =>
    setUploadingFiles(existingFiles => {
      delete existingFiles[id]
      const updatedExistingFiles = { ...existingFiles }
      return updatedExistingFiles
    })

  const sendMessageAction = React.useCallback(
    async (message: string) => {
      // Send message out of input value
      if (message) {
        dispatch(messages.actions.sendMessage({ message }))
      }
      // Upload files, then send corresponding message (contaning cid) for each of them
      Object.values(filesRef.current).forEach(async (fileData: FileContent) => {
        if (!fileData.path) return
        const destPath = `${RNFS.TemporaryDirectoryPath}/${fileData.name}.${fileData.ext}`
        console.log('DEST', destPath)
        // await RNFS.copyFile(fileData.path, destPath)

        try {
          console.log('THIS', decodeURIComponent(fileData.path))
          // const newFile = await RNFetchBlob.fs.stat(fileData.path);
          const aaa = await RNFS.stat(decodeURIComponent(fileData.path))
          console.log('after stat::----: ', aaa)
        } catch (e) {
          console.error('--->', e)
        }

        // dispatch(files.actions.uploadFile(fileData))
      })
      // Reset file previews for input state
      setUploadingFiles({})
    },
    [dispatch]
  )

  useEffect(() => {
    dispatch(messages.actions.resetCurrentPublicChannelCache())
  }, [currentChannel?.id])

  const [imagePreview, setImagePreview] = useState<FileMetadata | null>(null)

  const openUrl = useCallback((url: string) => {
    void Linking.openURL(url)
  }, [])

  if (!currentChannel) return null

  return (
    <Chat
      contextMenu={contextMenu}
      sendMessageAction={sendMessageAction}
      loadMessagesAction={loadMessages}
      handleBackButton={handleBackButton}
      channel={currentChannel}
      messages={{
        count: channelMessagesCount,
        groups: channelMessages,
      }}
      pendingMessages={pendingMessages}
      downloadStatuses={downloadStatusesMapping}
      downloadFile={downloadFile}
      cancelDownload={cancelDownload}
      imagePreview={imagePreview}
      setImagePreview={setImagePreview}
      openImagePreview={setImagePreview}
      updateUploadedFiles={updateUploadedFiles}
      removeFilePreview={removeFilePreview}
      openUrl={openUrl}
      uploadedFiles={uploadingFiles}
    />
  )
}
