import { Socket } from 'socket.io-client'
import { PayloadAction } from '@reduxjs/toolkit'
import { call, select, apply, put, take } from 'typed-redux-saga'
import { SocketActionTypes } from '../../socket/const/actionTypes'
import { identitySelectors } from '../../identity/identity.selectors'
import { messagesActions } from '../messages.slice'
import { Identity } from '../../identity/identity.types'
import { FileContent } from '../../files/files.types'
import { sendMessageSaga } from '../sendMessage/sendMessage.saga'

export function* uploadFileSaga(
  socket: Socket,
  action: PayloadAction<ReturnType<typeof messagesActions.uploadFile>['payload']>
): Generator {
  const identity: Identity = yield* select(identitySelectors.currentIdentity)

  const fileContent: FileContent = action.payload

  yield* apply(socket, socket.emit, [
    SocketActionTypes.UPLOAD_FILE,
    {
      file: fileContent,
      peerId: identity.peerId.id
    }
  ])

  // const uploadedFileMetadata = yield* take(messagesActions.uploadedFile)
  // console.log('uploadedFileMetadata', uploadedFileMetadata)

  // yield* put(messagesActions.sendFile({
  //   message: action.payload.buffer,
  //   channelAddress: action.payload.dir,
  //   cid: uploadedFileMetadata.payload.cid
  // }))
}
