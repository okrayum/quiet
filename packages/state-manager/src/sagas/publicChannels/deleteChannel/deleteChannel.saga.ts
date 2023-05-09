import { publicChannelsActions } from '../publicChannels.slice'
import { PayloadAction } from '@reduxjs/toolkit'
import { SocketActionTypes } from '../../socket/const/actionTypes'
import { apply, put } from 'typed-redux-saga'
import { Socket, applyEmitParams } from '../../../types'

import logger from '../../../utils/logger'
const log = logger('publicChannels')

export function* deleteChannelSaga(
  socket: Socket,
  action: PayloadAction<ReturnType<typeof publicChannelsActions.deleteChannel>['payload']>
): Generator {
  const channelAddress = action.payload.channel
  const isGeneral = channelAddress === 'general'

  log(`Deleting channel ${channelAddress}`)
  yield* apply(
    socket,
    socket.emit,
    applyEmitParams(SocketActionTypes.DELETE_CHANNEL, {
      channel: channelAddress
    })
  )

  if (!isGeneral) {
    yield* put(publicChannelsActions.setCurrentChannel({ channelAddress: 'general' }))
    yield* put(publicChannelsActions.disableChannel({ channelAddress }))
  }
}
