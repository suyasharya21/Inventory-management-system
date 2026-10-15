#include <whisper.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {

uint16_t read_u16(const std::vector<uint8_t> & bytes, size_t offset) {
    uint16_t value = 0;
    std::memcpy(&value, bytes.data() + offset, sizeof(value));
    return value;
}

uint32_t read_u32(const std::vector<uint8_t> & bytes, size_t offset) {
    uint32_t value = 0;
    std::memcpy(&value, bytes.data() + offset, sizeof(value));
    return value;
}

bool has_tag(const std::vector<uint8_t> & bytes, size_t offset, const char * tag) {
    return offset + 4 <= bytes.size() && std::memcmp(bytes.data() + offset, tag, 4) == 0;
}

std::vector<float> read_wav(const std::string & path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) throw std::runtime_error("Audio file could not be opened.");
    const auto length = file.tellg();
    if (length < 44) throw std::runtime_error("Audio recording is incomplete.");
    std::vector<uint8_t> bytes(static_cast<size_t>(length));
    file.seekg(0);
    file.read(reinterpret_cast<char *>(bytes.data()), length);
    if (!has_tag(bytes, 0, "RIFF") || !has_tag(bytes, 8, "WAVE")) throw std::runtime_error("Audio recording is not a WAV file.");

    uint16_t format = 0;
    uint16_t channels = 0;
    uint16_t bits_per_sample = 0;
    uint32_t sample_rate = 0;
    size_t data_offset = 0;
    uint32_t data_size = 0;
    for (size_t offset = 12; offset + 8 <= bytes.size();) {
        const uint32_t chunk_size = read_u32(bytes, offset + 4);
        const size_t chunk_data = offset + 8;
        if (chunk_data + chunk_size > bytes.size()) break;
        if (has_tag(bytes, offset, "fmt ") && chunk_size >= 16) {
            format = read_u16(bytes, chunk_data);
            channels = read_u16(bytes, chunk_data + 2);
            sample_rate = read_u32(bytes, chunk_data + 4);
            bits_per_sample = read_u16(bytes, chunk_data + 14);
        } else if (has_tag(bytes, offset, "data")) {
            data_offset = chunk_data;
            data_size = chunk_size;
        }
        offset = chunk_data + chunk_size + (chunk_size % 2);
    }
    if (format != 1 || channels != 1 || sample_rate != 16000 || bits_per_sample != 16 || data_offset == 0) {
        throw std::runtime_error("Audio must be 16 kHz, mono, 16-bit PCM.");
    }
    const size_t sample_count = data_size / sizeof(int16_t);
    std::vector<float> samples(sample_count);
    for (size_t index = 0; index < sample_count; ++index) {
        int16_t value = 0;
        std::memcpy(&value, bytes.data() + data_offset + index * sizeof(int16_t), sizeof(value));
        samples[index] = static_cast<float>(value) / 32768.0f;
    }
    return samples;
}

std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

} // namespace

int main(int argc, char ** argv) {
    if (argc < 3) {
        std::cerr << "Usage: stocksense-stt MODEL WAV [LANGUAGE] [PROMPT]\n";
        return 2;
    }
    try {
        const std::string language = argc > 3 ? argv[3] : "en";
        const std::string prompt = argc > 4 ? argv[4] : "Inventory command with a product name and quantity.";
        const auto samples = read_wav(argv[2]);
        auto context_params = whisper_context_default_params();
        // CPU mode is more reliable across customer Macs and is fast enough for short commands.
        context_params.use_gpu = false;
        whisper_context * context = whisper_init_from_file_with_params(argv[1], context_params);
        if (!context) throw std::runtime_error("The local speech model could not be loaded.");

        auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads = static_cast<int>(std::max(1u, std::min(4u, std::thread::hardware_concurrency())));
        params.language = language.c_str();
        params.initial_prompt = prompt.c_str();
        params.translate = false;
        params.no_context = true;
        params.no_timestamps = true;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_timestamps = false;
        params.single_segment = true;
        params.suppress_blank = true;

        if (whisper_full(context, params, samples.data(), static_cast<int>(samples.size())) != 0) {
            whisper_free(context);
            throw std::runtime_error("Local speech transcription failed.");
        }
        std::string transcript;
        const int segments = whisper_full_n_segments(context);
        for (int index = 0; index < segments; ++index) transcript += whisper_full_get_segment_text(context, index);
        whisper_free(context);
        std::cout << trim(transcript) << '\n';
        return 0;
    } catch (const std::exception & error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
