cmake_minimum_required(VERSION 3.22)
project(spike_bench CXX)
set(CMAKE_CXX_STANDARD 17)
# Path to the downloaded AAR (git-ignored build input). Override with
# -DORT_AAR=<path> when invoking cmake.
set(ORT_AAR
    "${CMAKE_CURRENT_SOURCE_DIR}/../../logs/spike-ndk/thirdparty/onnxruntime-android-1.22.0.aar"
    CACHE FILEPATH "onnxruntime Android AAR")
set(ORT_DIR "${CMAKE_CURRENT_BINARY_DIR}/ort")
file(ARCHIVE_EXTRACT INPUT "${ORT_AAR}" DESTINATION "${ORT_DIR}")
add_executable(spike_bench bench.cpp)
target_include_directories(spike_bench PRIVATE "${ORT_DIR}/headers")
target_link_libraries(spike_bench
    "${ORT_DIR}/jni/${ANDROID_ABI}/libonnxruntime.so" log)
set_target_properties(spike_bench PROPERTIES
    BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
