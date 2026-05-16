"""
生成一段简单的 chill lo-fi 背景音乐
- 舒缓的 pad 和弦
- 轻柔的鼓点
- 30 秒长度
"""
import wave
import math
import struct
import random

SAMPLE_RATE = 44100
DURATION = 30.0
NUM_SAMPLES = int(SAMPLE_RATE * DURATION)

# 和弦进行 (C大调 - Am - F - G - C)
CHORDS = [
    [261.63, 329.63, 392.00],  # C major
    [220.00, 261.63, 329.63],  # Am
    [174.61, 220.00, 261.63],  # F major
    [196.00, 246.94, 293.66],  # G major
]

# 每个和弦的时长（拍数 x 秒/拍）
BPM = 75
BEAT_DURATION = 60.0 / BPM
BEATS_PER_CHORD = 4
CHORD_DURATION = BEATS_PER_CHORD * BEAT_DURATION

random.seed(42)

def generate_pad(t, freq, amp=0.15):
    """生成柔和的 pad 音色"""
    # 主音
    val = math.sin(2 * math.pi * freq * t)
    # 加入轻微失谐的第二个泛音
    val += 0.3 * math.sin(2 * math.pi * freq * 1.01 * t)
    # 加入 sub 八度
    val += 0.2 * math.sin(2 * math.pi * freq * 0.5 * t)
    # 振幅包络 - 缓慢淡入淡出
    env = min(1.0, t * 2)  # 2s fade in
    env = min(env, (DURATION - t) * 2)  # fade out near end
    return val * amp * min(env, 1.0)

def generate_kick(t, beat_start, amp=0.3):
    """生成轻柔的底鼓"""
    dt = t - beat_start
    if dt < 0 or dt > 0.15:
        return 0
    # 低频正弦 + 衰减
    freq = 80 - dt * 300
    env = 1.0 - dt / 0.15
    return math.sin(2 * math.pi * freq * dt) * amp * env

def generate_hihat(t, beat_start, amp=0.08):
    """生成轻响的 hi-hat"""
    dt = t - beat_start
    if dt < 0 or dt > 0.04:
        return 0
    # 噪音 + 极短衰减
    noise = random.random() * 2 - 1
    env = 1.0 - dt / 0.04
    return noise * amp * env

def generate_melody(t):
    """生成一个简单的飘过旋律"""
    # 在 8 秒后才开始，中间短暂出现
    if t < 8 or t > 22:
        return 0
    local_t = t - 8
    # 简单的上行音阶
    notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50]
    note_dur = 2.0
    note_idx = int(local_t / note_dur) % len(notes)
    note_t = local_t % note_dur
    freq = notes[note_idx]
    # 柔和的正弦波
    env = math.sin(math.pi * note_t / note_dur)  # 正弦包络
    return 0.06 * math.sin(2 * math.pi * freq * t) * env

print(f"Generating {DURATION}s chill lo-fi audio at {SAMPLE_RATE}Hz...")

samples = []
chord_idx = 0
chord_start = 0

for i in range(NUM_SAMPLES):
    t = i / SAMPLE_RATE
    
    # 当前和弦
    chord_idx = int(t / CHORD_DURATION) % len(CHORDS)
    chord = CHORDS[chord_idx]
    
    # Pad 和弦
    val = 0
    for freq in chord:
        val += generate_pad(t, freq, 0.12)
    
    # 旋律
    val += generate_melody(t)
    
    # 鼓点 - 每拍
    beat_idx = int(t / BEAT_DURATION)
    beat_time = beat_idx * BEAT_DURATION
    
    # Kick on 1 and 3
    if beat_idx % 2 == 0:
        val += generate_kick(t, beat_time, 0.2)
    
    # Hi-hat on every offbeat
    if beat_idx % 1 == 0:
        val += generate_hihat(t, beat_time + BEAT_DURATION/2, 0.04)
    
    # 限制范围
    val = max(-0.95, min(0.95, val))
    
    samples.append(val)

print("Converting to WAV...")

# 写入 WAV 文件
output_path = "scripts/bg_music.wav"
with wave.open(output_path, 'w') as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(SAMPLE_RATE)
    
    for s in samples:
        wf.writeframes(struct.pack('<h', int(s * 32767)))

print(f"Done! Saved to {output_path}")
print(f"Duration: {len(samples)/SAMPLE_RATE:.1f}s")
