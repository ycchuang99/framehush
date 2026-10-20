# Audio fixture

`speech.wav` is a mono, 48 kHz, 16-bit PCM file generated locally with the macOS Samantha voice for these tests.
It contains this text.

> This is a speech clarity test. You should hear each sentence while the background noise becomes quieter. Framehush processes the sound on this computer.

`player.html` mixes the speech with deterministic noise and plays it through a video element.
The first and last two seconds contain noise only.
The fixture loops so browser lifecycle checks can run without external websites.
The generated speech tests signal preservation. It does not establish intelligibility for every recording.
