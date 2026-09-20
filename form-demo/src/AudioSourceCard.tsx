import { useEffect, useRef, useState } from 'react'
import { FileAudio, Mic, Square, Upload } from 'lucide-react'
import { Button } from './components/ui/button'

export type AudioMode = 'upload' | 'microphone'
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

export function AudioSourceCard({ mode, onModeChange, onUseAudio, onSampleSelected, onBusyChange, recognizing }: {
  recognizing: boolean; mode: AudioMode; onModeChange: (mode: AudioMode) => void;
  onUseAudio: () => void; onSampleSelected: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null)
  const [hasCaptured, setHasCaptured] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'stopping'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [animateMode, setAnimateMode] = useState(false)
  const discardCapture = useRef(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  const busyCallback = useRef(onBusyChange)
  busyCallback.current = onBusyChange
  const stop = () => {
    generation.current++
    if (recorder.current) { setPhase('stopping'); if (recorder.current.state !== 'inactive') recorder.current.stop() }
    else { setPhase('idle'); onBusyChange(false) }
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      if (recorder.current) {
        recorder.current.onstop = null
        recorder.current.onerror = null
        recorder.current.ondataavailable = null
        if (recorder.current.state !== 'inactive') recorder.current.stop()
      }
      stream.current?.getTracks().forEach(track => track.stop())
      busyCallback.current(false)
    }
  }, [])
  useEffect(() => {
    if (phase !== 'recording') return
    const start = performance.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - start) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [phase])

  const chooseFile = (selected?: File) => {
    if (!selected) return
    if (!/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(selected.name) && !selected.type.startsWith('audio/')) { setError('请选择音频文件。'); return }
    if (!selected.size || selected.size > 50 * 1024 * 1024) { setError('请选择非空且不超过 50 MB 的音频文件。'); return }
    setFile(selected)
    setError('')
    onUseAudio()
    onSampleSelected()
  }
  const start = async () => {
    if (phase !== 'idle' || recorder.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('当前浏览器不支持麦克风录制，请使用 Chrome 或上传音频。'); return }
    onUseAudio()
    setError('')
    setPhase('requesting')
    onBusyChange(true)
    discardCapture.current = false
    const attempt = ++generation.current
    let acquired: MediaStream | null = null
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || attempt !== generation.current) { acquired.getTracks().forEach(track => track.stop()); return }
      stream.current = acquired
      const current = new MediaRecorder(acquired)
      recorder.current = current
      let bytes = 0
      current.ondataavailable = event => {
        if (event.data.size) { bytes += event.data.size }
        if (bytes >= 50 * 1024 * 1024 && current.state === 'recording') { setError('录音达到 50 MB，已自动停止。'); stop() }
      }
      current.onstop = () => {
        acquired?.getTracks().forEach(track => track.stop())
        if (!mounted.current || recorder.current !== current) return
        recorder.current = null
        stream.current = null
        setPhase('idle')
        busyCallback.current(false)
        if (!discardCapture.current) {
          if (bytes) setHasCaptured(true)
          else setError('未获取到音频，请检查麦克风后重试。')
        }
      }
      current.onerror = () => { setError('录音中断，请检查设备后重试。'); stop() }
      acquired.getAudioTracks().forEach(track => { track.onended = () => { if (current.state === 'recording') { setError('麦克风已断开，录音已停止。'); stop() } } })
      current.start(1000)
      setSeconds(0)
      setPhase('recording')
    } catch (err) {
      acquired?.getTracks().forEach(track => track.stop())
      if (!mounted.current || attempt !== generation.current) return
      recorder.current = null
      stream.current = null
      setPhase('idle')
      onBusyChange(false)
      const name = err instanceof DOMException ? err.name : ''
      setError(name === 'NotAllowedError' ? '麦克风权限未开启，请在浏览器中允许后重试。' : name === 'NotFoundError' ? '未找到麦克风，请连接设备后重试。' : '无法使用麦克风，请检查设备是否被占用。')
    }
  }
  const switchMode = (next: AudioMode, animate: boolean) => {
    if (next === mode || (next === 'microphone' && recognizing)) return
    setAnimateMode(animate)
    discardCapture.current = true
    onUseAudio()
    stop()
    onModeChange(next)
    setError('')
  }

  return <section className="audio-source-card" data-animate-mode={animateMode} aria-labelledby="audio-source-title" data-motion-static>
    <div className="audio-source-heading"><h2 id="audio-source-title">音频来源</h2><span>转写待接入</span></div>
    <div className="audio-source-modes" data-mode={mode} role="group" aria-label="音频来源模式">
      <Button variant="ghost" aria-pressed={mode === 'upload'} onClick={event => switchMode('upload', event.detail > 0)}><Upload size={14}/>上传音频</Button>
      <Button variant="ghost" aria-pressed={mode === 'microphone'} disabled={recognizing} title={recognizing ? '识别过程中不可切换' : undefined} onClick={event => switchMode('microphone', event.detail > 0)}><Mic size={14}/>麦克风实时</Button>
    </div>
    <div key={mode} className="audio-source-content">
    {mode === 'upload' ? <>
      <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac" hidden aria-label="选择音频文件" onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = '' }}/>
      {!file ? <Button variant="outline" className="audio-upload" onClick={() => input.current?.click()}><FileAudio size={20}/><span>选择音频文件<small>MP3、WAV、M4A 等 · 最大 50 MB</small></span></Button> : <div className="audio-file-row"><FileAudio size={18}/><div><strong title={file.name}>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></div></div>}
      {file && <Button variant="outline" size="sm" onClick={() => input.current?.click()}>更换音频</Button>}
    </> : <>
      <div className="audio-mic-status"><span className={phase === 'recording' ? 'is-recording' : ''}>{phase === 'recording' ? '● 正在拾音' : phase === 'requesting' ? '等待麦克风授权' : phase === 'stopping' ? '正在停止拾音' : hasCaptured ? '拾音已结束' : '麦克风未开启'}</span><time>{formatTime(seconds)}</time></div>
      <Button className="audio-record-button" disabled={phase === 'stopping'} onClick={phase === 'idle' ? start : stop}>{phase === 'idle' ? <Mic size={14}/> : <Square size={14}/>}{phase === 'idle' ? '开始拾音' : phase === 'requesting' ? '取消' : '停止拾音'}</Button>
    </>}
    {error && <p className="audio-source-error" role="alert">{error}</p>}
    </div>
  </section>
}
