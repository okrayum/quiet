import { combineReducers } from 'redux'
import { expectSaga, testSaga } from 'redux-saga-test-plan'
import { call } from 'redux-saga-test-plan/matchers'
import { delay } from 'typed-redux-saga'
import { Store } from '@reduxjs/toolkit'
import { setupCrypto } from '@quiet/identity'
import {
  Community,
  communitiesActions
} from '../../communities/communities.slice'
import { identityActions } from '../../identity/identity.slice'
import { Identity } from '../../identity/identity.types'
import { errorsActions } from '../errors.slice'
import { ErrorCodes, ErrorMessages, ErrorTypes } from '../errors.types'
import { handleErrorsSaga } from './handleErrors.saga'
import { prepareStore, reducers } from '../../../utils/tests/prepareStore'
import { getFactory } from '../../../utils/tests/factories'

describe('handle errors', () => {
  setupCrypto()

  let store: Store
  let community: Community
  let identity: Identity

  beforeEach(async () => {
    store = prepareStore({}).store
  })

  test('receiving registrar server error results in retrying registration and not putting error in store', async () => {
    const factory = await getFactory(store)
    community = await factory.create<
    ReturnType<typeof communitiesActions.addNewCommunity>['payload']
    >('Community')
    identity = await factory.create<ReturnType<typeof identityActions.addNewIdentity>['payload']>(
      'Identity',
      { id: community.id, nickname: 'alice' }
    )

    const reducer = combineReducers(reducers)

    const errorPayload = {
      community: community.id,
      type: ErrorTypes.REGISTRAR,
      code: ErrorCodes.NOT_FOUND,
      message: ErrorMessages.REGISTRAR_NOT_FOUND
    }
    await expectSaga(
      handleErrorsSaga,
      errorsActions.handleError(errorPayload)
    )
      .withReducer(reducer)
      .withState(store.getState())
      .provide([[call.fn(delay), null]])
      .put(
        identityActions.registerCertificate({
          communityId: community.id,
          nickname: identity.nickname,
          userCsr: identity.userCsr
        })
      )
      .not
      .put(errorsActions.addError(errorPayload))
      .run()
  })

  test('taken username error does not trigger re-registration and puts error into store', async () => {
    const factory = await getFactory(store)
    community = await factory.create<
    ReturnType<typeof communitiesActions.addNewCommunity>['payload']
    >('Community')
    identity = await factory.create<ReturnType<typeof identityActions.addNewIdentity>['payload']>(
      'Identity',
      { id: community.id, nickname: 'alice' }
    )

    const reducer = combineReducers(reducers)

    const errorPayload = {
      type: ErrorTypes.REGISTRAR,
      code: ErrorCodes.FORBIDDEN,
      message: ErrorMessages.USERNAME_TAKEN,
      community: community.id
    }
    await expectSaga(
      handleErrorsSaga,
      errorsActions.handleError(errorPayload)
    )
      .withReducer(reducer)
      .withState(store.getState())
      .provide([[call.fn(delay), null]])
      .not
      .put(
        identityActions.registerCertificate({
          communityId: community.id,
          nickname: identity.nickname,
          userCsr: identity.userCsr
        })
      )
      .put(errorsActions.addError(errorPayload))
      .run()
  })

  test('Error other than registrar error adds error to store', async () => {
    const errorPayload = {
      type: ErrorTypes.OTHER,
      message: ErrorMessages.NETWORK_SETUP_FAILED,
      code: ErrorCodes.BAD_REQUEST
    }
    const addErrorAction = errorsActions.handleError(errorPayload)
    testSaga(handleErrorsSaga, addErrorAction).next().put(errorsActions.addError(errorPayload)).next().isDone()
  })
})
