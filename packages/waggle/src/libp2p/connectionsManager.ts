import { NOISE } from '@chainsafe/libp2p-noise'
import { Crypto } from '@peculiar/webcrypto'
import { Agent } from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import Libp2p, { Connection } from 'libp2p'
import SocketIO from 'socket.io'
import Bootstrap from 'libp2p-bootstrap'
import Gossipsub from 'libp2p-gossipsub'
import KademliaDHT from 'libp2p-kad-dht'
import Mplex from 'libp2p-mplex'
import { Response } from 'node-fetch'
import * as os from 'os'
import PeerId from 'peer-id'
import { CryptoEngine, setEngine } from 'pkijs'
import { CertsData, ConnectionsManagerOptions } from '../common/types'
import {
  createLibp2pAddress,
  createLibp2pListenAddress,
  fetchRetry,
  getPorts,
  torBinForPlatform,
  torDirForPlatform
} from '../common/utils'
import { ZBAY_DIR_PATH } from '../constants'
import logger from '../logger'
import IOProxy from '../socket/IOProxy'
import initListeners from '../socket/listeners'
import { Storage } from '../storage'
import { Tor } from '../torManager'
import WebsocketsOverTor from './websocketOverTor'
const log = logger('conn')

export interface IConstructor {
  host?: string
  port?: number
  agentPort?: number
  agentHost?: string
  options?: Partial<ConnectionsManagerOptions>
  io: SocketIO.Server
  storageClass?: any // TODO: what type?
  httpTunnelPort?: number
}

export class ConnectionsManager {
  agentHost: string
  agentPort: number
  httpTunnelPort: number
  socksProxyAgent: any
  options: ConnectionsManagerOptions
  zbayDir: string
  io: SocketIO.Server
  ioProxy: IOProxy
  libp2pTransportClass: any
  StorageCls: any
  tor: Tor
  libp2pInstance: any

  constructor({ agentHost, agentPort, httpTunnelPort, options, storageClass, io }: IConstructor) {
    this.io = io
    this.agentPort = agentPort
    this.httpTunnelPort = httpTunnelPort
    this.agentHost = agentHost
    this.socksProxyAgent = this.createAgent()
    this.options = {
      ...new ConnectionsManagerOptions(),
      ...options
    }
    this.zbayDir = this.options.env?.appDataPath || ZBAY_DIR_PATH
    this.StorageCls = storageClass || Storage
    this.libp2pTransportClass = options.libp2pTransportClass || WebsocketsOverTor
    this.ioProxy = new IOProxy(this)

    process.on('unhandledRejection', error => {
      console.error(error)
      throw new Error()
    })
    process.on('SIGINT', function () {
      log('\nGracefully shutting down from SIGINT (Ctrl-C)')
      process.exit(0)
    })

    const webcrypto = new Crypto()
    setEngine(
      'newEngine',
      webcrypto,
      new CryptoEngine({
        name: '',
        crypto: webcrypto,
        subtle: webcrypto.subtle
      })
    )
  }

  public readonly createAgent = (): Agent => {
    if (this.socksProxyAgent || !this.agentPort || !this.agentHost) return

    log(`Creating https proxy agent: ${this.httpTunnelPort}`)

    return new HttpsProxyAgent({ port: this.httpTunnelPort, host: this.agentHost })
  }

  public readonly createLibp2pAddress = (address: string, port: number, peerId: string): string => {
    return createLibp2pAddress(address, port, peerId, this.options.wsType)
  }

  public readonly createLibp2pListenAddress = (address: string, port: number): string => {
    return createLibp2pListenAddress(address, port, this.options.wsType)
  }

  public initListeners = () => {
    initListeners(this.io, this.ioProxy)
    log('Initialized socket listeners')
  }

  public createNetwork = async () => {
    const ports = await getPorts()
    let hiddenService
    if (this.tor) {
      hiddenService = await this.tor.createNewHiddenService(443, ports.libp2pHiddenService)
      await this.tor.destroyHiddenService(hiddenService.onionAddress.split('.')[0])
    } else {
      hiddenService = {
        onionAddress: '0.0.0.0',
        privateKey: ''
      }
    }

    const peerId = await PeerId.create()
    log(
      `Created network for peer ${peerId.toB58String()}. Address: ${
        hiddenService.onionAddress as string
      }`
    )
    return {
      hiddenService,
      peerId: peerId.toJSON()
    }
  }

  public init = async () => {
    this.initListeners()
    await this.spawnTor()
  }

  public closeAllServices = async () => {
    this.io.close()
    await this.ioProxy.closeAll()
  }

  public spawnTor = async () => {
    const basePath = this.options.env.resourcesPath || ''
    this.tor = new Tor({
      torPath: torBinForPlatform(basePath),
      appDataPath: this.zbayDir,
      controlPort: this.options.torControlPort,
      socksPort: this.agentPort,
      torPassword: this.options.torPassword,
      torAuthCookie: this.options.torAuthCookie,
      httpTunnelPort: this.httpTunnelPort,

      options: {
        env: {
          LD_LIBRARY_PATH: torDirForPlatform(basePath),
          HOME: os.homedir()
        },
        detached: true
      }
    })

    if (this.options.spawnTor) {
      await this.tor.init()
      log('Spawned Tor')
    } else {
      this.tor.initTorControl()
      log('Initialized tor control')
    }
  }

  public initLibp2p = async (
    peerId: PeerId,
    address: string,
    addressPort: number,
    bootstrapMultiaddrs: string[],
    certs: CertsData,
    targetPort: number
  ): Promise<{ libp2p: Libp2p; localAddress: string }> => {
    const localAddress = this.createLibp2pAddress(address, addressPort, peerId.toB58String())
    log(`Initializing libp2p for ${peerId.toB58String()}`)
    const libp2p = ConnectionsManager.createBootstrapNode({
      peerId: peerId,
      listenAddrs: [this.createLibp2pListenAddress(address, addressPort)],
      agent: this.socksProxyAgent,
      localAddr: localAddress,
      ...certs,
      bootstrapMultiaddrsList: bootstrapMultiaddrs,
      transportClass: this.libp2pTransportClass,
      targetPort
    })

    this.libp2pInstance = libp2p

    libp2p.connectionManager.on('peer:connect', (connection: Connection) => {
      log(`${peerId.toB58String()} connected to ${connection.remotePeer.toB58String()}`)
    })
    libp2p.on('peer:discovery', (peer: PeerId) => {
      log(`${peerId.toB58String()} discovered ${peer.toB58String()}`)
    })
    libp2p.connectionManager.on('peer:disconnect', (connection: Connection) => {
      log(`${peerId.toB58String()} disconnected from ${connection.remotePeer.toB58String()}`)
    })
    log(`Initialized libp2p for peer ${peerId.toB58String()}`)
    return {
      libp2p,
      localAddress
    }
  }

  public createStorage = (peerId: string, communityId: string) => {
    log(`Creating storage for community: ${communityId}`)
    return new this.StorageCls(this.zbayDir, this.io, communityId, {
      ...this.options,
      orbitDbDir: `OrbitDB${peerId}`,
      ipfsDir: `Ipfs${peerId}`
    })
  }

  public sendCertificateRegistrationRequest = async (
    serviceAddress: string,
    userCsr: string,
    retryCount: number = 3
  ): Promise<Response> => {
    let options
    if (this.tor) {
      options = {
        method: 'POST',
        body: JSON.stringify({ data: userCsr }),
        headers: { 'Content-Type': 'application/json' },
        agent: this.socksProxyAgent
      }
    } else {
      options = {
        method: 'POST',
        body: JSON.stringify({ data: userCsr }),
        headers: { 'Content-Type': 'application/json' }
      }
    }

    try {
      return await fetchRetry(serviceAddress + '/register', options, retryCount)
    } catch (e) {
      log.error(e)
      throw e
    }
  }

  public static readonly createBootstrapNode = ({
    peerId,
    listenAddrs,
    agent,
    cert,
    key,
    ca,
    localAddr,
    bootstrapMultiaddrsList,
    transportClass,
    targetPort
  }): Libp2p => {
    return ConnectionsManager.defaultLibp2pNode({
      peerId,
      listenAddrs,
      agent,
      cert,
      key,
      ca,
      localAddr,
      bootstrapMultiaddrsList,
      transportClass,
      targetPort
    })
  }

  private static readonly defaultLibp2pNode = ({
    peerId,
    listenAddrs,
    agent,
    cert,
    key,
    ca,
    localAddr,
    bootstrapMultiaddrsList,
    transportClass,
    targetPort
  }): Libp2p => {
    return new Libp2p({
      peerId,
      addresses: {
        listen: listenAddrs
      },
      modules: {
        transport: [transportClass],
        peerDiscovery: [Bootstrap],
        streamMuxer: [Mplex],
        connEncryption: [NOISE],
        dht: KademliaDHT,
        pubsub: Gossipsub
      },
      dialer: {
        dialTimeout: 120_000
      },
      config: {
        peerDiscovery: {
          [Bootstrap.tag]: {
            enabled: true,
            list: bootstrapMultiaddrsList // provide array of multiaddrs
          },
          autoDial: true
        },
        relay: {
          enabled: true,
          hop: {
            enabled: true,
            active: false
          }
        },
        dht: {
          enabled: true,
          randomWalk: {
            enabled: true
          }
        },
        transport: {
          [transportClass.name]: {
            websocket: {
              agent,
              cert,
              key,
              ca
            },
            localAddr,
            targetPort
          }
        }
      }
    })
  }
}
