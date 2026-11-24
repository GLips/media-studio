// face-box.swift: the largest face in an image, by macOS Vision. Prints one JSON line: the face's box as fractions
// of the image, origin top-left, or {"face":null}. Built once by face-box.ts with swiftc; Vision needs no model file.
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 2 else {
  FileHandle.standardError.write("usage: face-box <image>\n".data(using: .utf8)!)
  exit(2)
}

let request = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(url: URL(fileURLWithPath: args[1]), options: [:])
do {
  try handler.perform([request])
} catch {
  FileHandle.standardError.write("\(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}

let faces = request.results ?? []
guard let face = faces.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) else {
  print("{\"face\":null}")
  exit(0)
}
// Vision's origin is bottom-left; the studio's frames are read top-down.
let box = face.boundingBox
print("{\"face\":{\"x\":\(box.minX),\"y\":\(1 - box.maxY),\"width\":\(box.width),\"height\":\(box.height)}}")
